// expo-notifications stand-in, wired up per test file with
//   jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);
// Defaults: permission granted, no notification response.
import type { NotificationResponse } from 'expo-notifications';

export const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };

export const notificationsMock = {
  DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
  AndroidImportance: { DEFAULT: 5 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => ({})),
  getPermissionsAsync: jest.fn(async () => granted),
  requestPermissionsAsync: jest.fn(async () => granted),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async (_request: { identifier?: string }) => 'id'),
  dismissNotificationAsync: jest.fn(async () => {}),
  useLastNotificationResponse: jest.fn((): NotificationResponse | null => null),
  clearLastNotificationResponse: jest.fn(),
};

export const deniedPermission = (canAskAgain: boolean) => ({
  status: 'denied',
  granted: false,
  canAskAgain,
  expires: 'never',
});

/** A tap on a scheduled reminder: the body (default) or one of its buttons. */
export function notificationResponse(
  data: Record<string, unknown>,
  actionIdentifier = DEFAULT_ACTION,
): NotificationResponse {
  return {
    actionIdentifier,
    notification: {
      date: 0,
      request: { identifier: 'checkup-2026-10-24', content: { data }, trigger: null },
    },
  } as unknown as NotificationResponse;
}
