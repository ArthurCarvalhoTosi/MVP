import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { Db } from '@/db/client';
import { allItemsQuery, selectVehicle, setSnooze } from '@/db/repo';
import { addDays, SNOOZE_DAYS, todayISO } from '@/domain';
import { ACTION_DONE, ACTION_SNOOZE, type NotificationData } from './scheduler';

/**
 * Routes a tap on a reminder: Feito opens the log for that item on its car, Adiar 15 dias snoozes it and
 * shows the check-up, and anything else (a body tap, or an item or car removed since) shows the check-up.
 */
export async function respondToNotification(db: Db, response: Notifications.NotificationResponse): Promise<void> {
  const { actionIdentifier, notification } = response;
  if (actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    // Android leaves the notification up after a button tap; losing this only leaves it in the tray.
    Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
  }

  const data = notification.request.content.data as Partial<NotificationData> | null;
  const itemId = data?.kind === 'critical' && typeof data.itemId === 'string' ? data.itemId : null;
  // allItemsQuery skips removed items and items of removed cars.
  const item = itemId ? allItemsQuery(db).all().find((i) => i.id === itemId) : undefined;

  try {
    if (item && actionIdentifier === ACTION_DONE) {
      await selectVehicle(db, item.vehicleId);
      router.push({ pathname: '/register', params: { itemId: item.id } });
      return;
    }
    if (item && actionIdentifier === ACTION_SNOOZE) {
      await setSnooze(db, item.id, addDays(todayISO(), SNOOZE_DAYS));
      router.push({ pathname: '/checkup', params: { snoozed: item.id } });
      return;
    }
  } catch {
    // A failed write falls through to the check-up, where the item still offers both actions.
  }
  router.push('/checkup');
}
