import { Platform } from 'react-native';
import type { DigestNotification } from '@/domain';
import { deniedPermission, type notificationsMock } from '@/test-utils/notifications';

jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);

// Fresh module state (setup done, last plan) and a fresh mock per test.
let N: typeof notificationsMock;
let scheduler: typeof import('../scheduler');
beforeEach(() => {
  jest.resetModules();
  N = require('expo-notifications');
  scheduler = require('../scheduler');
});

const summary: DigestNotification = {
  kind: 'summary',
  date: '2099-10-24',
  title: 'Check-up da semana',
  body: '2 trocas precisam de atenção: Óleo, Freios.',
};
const critical: DigestNotification = {
  kind: 'critical',
  date: '2099-10-31',
  title: 'Óleo',
  body: 'Meu Sandero: vencido há 3 dias.',
  itemId: 'oil',
  vehicleId: 'sandero',
};

test('schedules each Saturday at 09h local, the single critical item with its buttons', async () => {
  await scheduler.scheduleDigest([summary, critical]);

  expect(N.setNotificationCategoryAsync).toHaveBeenCalledWith('critical_item', [
    { identifier: 'done', buttonTitle: 'Feito', options: { opensAppToForeground: true } },
    { identifier: 'snooze', buttonTitle: 'Adiar 15 dias', options: { opensAppToForeground: true } },
  ]);
  expect(N.setNotificationHandler).toHaveBeenCalledTimes(1);
  expect(N.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(N.scheduleNotificationAsync.mock.calls).toEqual([
    [
      {
        identifier: 'checkup-2099-10-24',
        content: { title: summary.title, body: summary.body, data: { kind: 'summary' } },
        trigger: { type: 'date', date: new Date(2099, 9, 24, 9), channelId: 'checkup' },
      },
    ],
    [
      {
        identifier: 'checkup-2099-10-31',
        content: {
          title: 'Óleo',
          body: critical.body,
          data: { kind: 'critical', itemId: 'oil', vehicleId: 'sandero' },
          categoryIdentifier: 'critical_item',
        },
        trigger: { type: 'date', date: new Date(2099, 9, 31, 9), channelId: 'checkup' },
      },
    ],
  ]);
});

test('cancels everything first, and leaves an unchanged plan alone', async () => {
  await scheduler.scheduleDigest([summary]);
  await scheduler.scheduleDigest([{ ...summary }]);
  expect(N.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

  // Everything snoozed or done: the old reminders go away.
  await scheduler.scheduleDigest([]);
  expect(N.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(2);
  expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('runs replacements one at a time, in order', async () => {
  const order: string[] = [];
  N.cancelAllScheduledNotificationsAsync.mockImplementation(async () => {
    order.push('cancel');
  });
  N.scheduleNotificationAsync.mockImplementation(async (req) => {
    order.push(req.identifier ?? '');
    return 'id';
  });

  await Promise.all([scheduler.scheduleDigest([summary]), scheduler.scheduleDigest([critical])]);

  expect(order).toEqual(['cancel', 'checkup-2099-10-24', 'cancel', 'checkup-2099-10-31']);
});

test('skips a Saturday whose time already passed', async () => {
  await scheduler.scheduleDigest([{ ...summary, date: '2020-01-04' }, critical]);
  expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(N.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ identifier: 'checkup-2099-10-31' }),
  );
});

test('schedules nothing without permission, and catches up once it is granted', async () => {
  N.getPermissionsAsync.mockResolvedValue(deniedPermission(true));
  await expect(scheduler.scheduleDigest([summary])).resolves.toBeUndefined();
  expect(N.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();

  N.getPermissionsAsync.mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  });
  await scheduler.rescheduleDigest();
  expect(N.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ identifier: 'checkup-2099-10-24' }),
  );
});

test('never rejects on a native failure, and retries the same plan next time', async () => {
  N.scheduleNotificationAsync.mockRejectedValueOnce(new Error('native'));
  await expect(scheduler.scheduleDigest([summary])).resolves.toBeUndefined();

  await scheduler.scheduleDigest([summary]);
  expect(N.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(2);
  expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
});

test('retries the setup after it fails', async () => {
  N.setNotificationCategoryAsync.mockRejectedValueOnce(new Error('native'));
  await scheduler.scheduleDigest([summary]);
  expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();

  await scheduler.scheduleDigest([summary]);
  expect(N.setNotificationCategoryAsync).toHaveBeenCalledTimes(2);
  expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('creates the Android channel, once, before anything else', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await scheduler.setupNotifications();
  await scheduler.scheduleDigest([summary]);

  expect(N.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
  expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('checkup', {
    name: 'Lembretes de manutenção',
    description: 'Check-up de sábado com as trocas que estão chegando.',
    importance: 5,
  });
  expect(N.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(
    N.scheduleNotificationAsync.mock.invocationCallOrder[0],
  );
});

test('sends the next planned reminder in 10 seconds for a dev test', async () => {
  expect(await scheduler.sendTestDigest()).toBe(false);

  await scheduler.scheduleDigest([critical, summary]);
  expect(await scheduler.sendTestDigest()).toBe(true);
  expect(N.scheduleNotificationAsync).toHaveBeenLastCalledWith({
    identifier: 'checkup-test',
    content: expect.objectContaining({ title: 'Óleo', categoryIdentifier: 'critical_item' }),
    trigger: { type: 'timeInterval', seconds: 10, channelId: 'checkup' },
  });
});
