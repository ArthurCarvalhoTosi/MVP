import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useDb } from '@/db/provider';
import { allItemsQuery, allReadingsQuery, vehiclesQuery } from '@/db/repo';
import { buildDigest } from '@/domain';
import { respondToNotification } from './responses';
import { scheduleDigest } from './scheduler';

/** Keeps the Saturday reminders in step with the data and routes taps on them. Mount once, under the database. */
export function useNotifications() {
  const db = useDb();
  const cars = useLiveQuery(vehiclesQuery(db));
  const items = useLiveQuery(allItemsQuery(db));
  const readings = useLiveQuery(allReadingsQuery(db));
  // Covers the cold start too: the response that opened the app is the first value.
  const response = Notifications.useLastNotificationResponse();
  const [foregrounds, setForegrounds] = useState(0);

  // Back in the app: maybe a new day, maybe the permission was changed in the system settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForegrounds((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const loaded = !!cars.updatedAt && !!items.updatedAt && !!readings.updatedAt;
  // A failed read leaves [] behind, which would wipe every reminder; keep the last schedule instead.
  const failed = !!(cars.error ?? items.error ?? readings.error);

  // Scheduling never writes to the database, so this can't feed back into the live queries.
  useEffect(() => {
    if (!loaded || failed) return;
    scheduleDigest(buildDigest(cars.data, items.data, readings.data, new Date()));
  }, [loaded, failed, cars.data, items.data, readings.data, foregrounds]);

  useEffect(() => {
    if (!response) return;
    // Cleared first, so a remount doesn't handle the same tap twice.
    Notifications.clearLastNotificationResponse();
    respondToNotification(db, response);
  }, [db, response]);
}
