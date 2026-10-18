import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { DIGEST_HOUR, type DigestNotification } from '@/domain';

const CHANNEL = 'checkup';
export const CRITICAL_CATEGORY = 'critical_item';
export const ACTION_DONE = 'done';
export const ACTION_SNOOZE = 'snooze';

/** What a scheduled notification carries for its response. */
export type NotificationData = { kind: 'summary' } | { kind: 'critical'; itemId: string; vehicleId: string };

let setup: Promise<void> | undefined;

/** Channel, buttons and foreground display; once per process. Must run before asking permission. */
export function setupNotifications(): Promise<void> {
  return (setup ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      // Android 13+ shows the permission prompt only once a channel exists.
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Lembretes de manutenção',
        description: 'Check-up de sábado com as trocas que estão chegando.',
        importance: AndroidImportance.DEFAULT,
      });
    }
    // Both buttons open the app. Handling them with the app closed needs expo-task-manager and still
    // isn't reliable; in the app, the write runs on the open database and the user sees the result.
    await Notifications.setNotificationCategoryAsync(CRITICAL_CATEGORY, [
      { identifier: ACTION_DONE, buttonTitle: 'Feito', options: { opensAppToForeground: true } },
      { identifier: ACTION_SNOOZE, buttonTitle: 'Adiar 15 dias', options: { opensAppToForeground: true } },
    ]);
  })().catch((error: unknown) => {
    setup = undefined;
    throw error;
  }));
}

function fireDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, DIGEST_HOUR);
}

function content(n: DigestNotification): Notifications.NotificationContentInput {
  const data: NotificationData =
    n.kind === 'critical' ? { kind: 'critical', itemId: n.itemId, vehicleId: n.vehicleId } : { kind: 'summary' };
  return {
    title: n.title,
    body: n.body,
    data,
    ...(n.kind === 'critical' ? { categoryIdentifier: CRITICAL_CATEGORY } : {}),
  };
}

let lastPlan: DigestNotification[] = [];
let lastKey: string | null = null;
// Runs one replacement at a time: two interleaved cancel-and-schedule passes could drop or duplicate reminders.
let queue: Promise<void> = Promise.resolve();

async function apply(plan: DigestNotification[]): Promise<void> {
  await setupNotifications();
  const { granted } = await Notifications.getPermissionsAsync();
  // Live queries fire on any write; an unchanged plan needs no native round trips.
  const key = JSON.stringify([granted, plan]);
  if (key === lastKey) return;
  lastKey = null;
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (granted) {
    const now = Date.now();
    for (const n of plan) {
      const date = fireDate(n.date);
      // A past date fires right away on Android; the plan can lag the clock by the time it took to get here.
      if (date.getTime() <= now) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `checkup-${n.date}`,
        content: content(n),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL },
      });
    }
  }
  lastKey = key;
}

/**
 * Replaces every scheduled reminder with `plan` (all-or-nothing is what keeps iOS under its 64 pending).
 * Never rejects: reminders are best effort, and a refused permission or a native failure must not reach the UI.
 */
export function scheduleDigest(plan: DigestNotification[]): Promise<void> {
  lastPlan = plan;
  queue = queue.then(() => apply(plan)).catch(() => {});
  return queue;
}

/** Applies the last plan again if the permission changed, e.g. right after it was granted. */
export function rescheduleDigest(): Promise<void> {
  return scheduleDigest(lastPlan);
}

/** Dev only: the next planned reminder in 10 seconds, time enough to close the app and test a cold start. */
export async function sendTestDigest(): Promise<boolean> {
  const next = lastPlan[0];
  if (!next) return false;
  await setupNotifications();
  await Notifications.scheduleNotificationAsync({
    identifier: 'checkup-test',
    content: content(next),
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: CHANNEL },
  });
  return true;
}
