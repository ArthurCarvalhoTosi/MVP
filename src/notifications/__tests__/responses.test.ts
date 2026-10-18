import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { removeVehicle, selectedVehicleIdQuery } from '@/db/repo';
import { maintenanceItems } from '@/db/schema';
import { addDays, todayISO } from '@/domain';
import { notificationResponse, notificationsMock as N } from '@/test-utils/notifications';
import { router, seedVehicle, setupScreen } from '@/test-utils/screens';
import { respondToNotification } from '../responses';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

let db: Db;
let sandero: string;
let oilId: string;
beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId: sandero, oilId } = await seedVehicle(db, addDays(todayISO(), -400)));
  // Created last, so the open car: Feito must switch back to the Sandero.
  await seedVehicle(db, todayISO(), { nickname: 'Meu Gol', odometerKm: 80000 });
});

const critical = () => ({ kind: 'critical', itemId: oilId, vehicleId: sandero });
const snoozedUntil = () =>
  db.select().from(maintenanceItems).where(eq(maintenanceItems.id, oilId)).get()?.snoozedUntil;

test('a tap on the summary opens the check-up', async () => {
  await respondToNotification(db, notificationResponse({ kind: 'summary' }));

  expect(router.push).toHaveBeenCalledWith('/checkup');
  expect(N.dismissNotificationAsync).not.toHaveBeenCalled();
});

test('a tap on the single item body opens the check-up too', async () => {
  await respondToNotification(db, notificationResponse(critical()));

  expect(router.push).toHaveBeenCalledWith('/checkup');
  expect(snoozedUntil()).toBeNull();
});

test('Feito opens the log for that item, on its car, and clears the notification', async () => {
  await respondToNotification(db, notificationResponse(critical(), 'done'));

  expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: sandero }]);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/register', params: { itemId: oilId } });
  expect(N.dismissNotificationAsync).toHaveBeenCalledWith('checkup-2026-10-24');
});

test('Adiar 15 dias snoozes the item from today and shows the check-up with it', async () => {
  await respondToNotification(db, notificationResponse(critical(), 'snooze'));

  expect(snoozedUntil()).toBe(addDays(todayISO(), 15));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/checkup', params: { snoozed: oilId } });
  expect(N.dismissNotificationAsync).toHaveBeenCalledWith('checkup-2026-10-24');
});

test.each(['done', 'snooze'])(
  '%s on an item whose car was removed opens the check-up and writes nothing',
  async (action) => {
    const before = selectedVehicleIdQuery(db).all();
    await removeVehicle(db, sandero);

    await respondToNotification(db, notificationResponse(critical(), action));

    expect(router.push).toHaveBeenCalledWith('/checkup');
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(selectedVehicleIdQuery(db).all()).toEqual(before);
    expect(snoozedUntil()).toBeNull();
  },
);

test('a failed write still lands on the check-up', async () => {
  const repo = require('@/db/repo');
  const spy = jest.spyOn(repo, 'setSnooze').mockRejectedValueOnce(new Error('disk I/O error'));

  await respondToNotification(db, notificationResponse(critical(), 'snooze'));

  expect(router.push).toHaveBeenCalledWith('/checkup');
  spy.mockRestore();
});
