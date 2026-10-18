import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { Db } from '@/db/client';
import { setSnooze } from '@/db/repo';
import { addDays, todayISO } from '@/domain';
import { notificationResponse, notificationsMock as N } from '@/test-utils/notifications';
import { router, seedVehicle, setupScreen } from '@/test-utils/screens';
import { scheduleDigest } from '../scheduler';
import { useNotifications } from '../useNotifications';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));
jest.mock('../scheduler', () => ({ ...jest.requireActual('../scheduler'), scheduleDigest: jest.fn() }));

function Host() {
  useNotifications();
  return null;
}

let db: Db;
let oilId: string;
beforeEach(async () => {
  db = await setupScreen();
  // 400 days at ~1.000 km/month: oil overdue, alone, so a single-item reminder every Saturday.
  ({ oilId } = await seedVehicle(db, addDays(todayISO(), -400)));
});

const lastPlan = () => jest.mocked(scheduleDigest).mock.lastCall?.[0];

test('plans the reminders from the data on open, and again when it changes', async () => {
  await render(<Host />);
  expect(lastPlan()).toHaveLength(8);
  expect(lastPlan()?.[0]).toMatchObject({ kind: 'critical', itemId: oilId, title: 'Troca de óleo e filtro' });

  // Snoozed past the whole plan: nothing left to remind.
  await setSnooze(db, oilId, addDays(todayISO(), 90));
  await render(<Host />);
  expect(lastPlan()).toEqual([]);
});

test('plans again when the app comes back to the foreground', async () => {
  // AppState is already a jest mock; its calls hold the listener.
  const addListener = jest.mocked(AppState.addEventListener);
  await render(<Host />);
  const listener = addListener.mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;
  const calls = jest.mocked(scheduleDigest).mock.calls.length;

  await act(async () => listener('background'));
  expect(jest.mocked(scheduleDigest).mock.calls.length).toBe(calls);

  await act(async () => listener('active'));
  expect(jest.mocked(scheduleDigest).mock.calls.length).toBeGreaterThan(calls);
});

test('handles the tap that opened the app once, then clears it', async () => {
  N.useLastNotificationResponse.mockReturnValue(notificationResponse({ kind: 'summary' }));
  try {
    await render(<Host />);
  } finally {
    N.useLastNotificationResponse.mockReturnValue(null);
  }

  expect(router.push).toHaveBeenCalledWith('/checkup');
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(N.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
});

test('does nothing without a tap', async () => {
  await render(<Host />);

  expect(router.push).not.toHaveBeenCalled();
  expect(N.clearLastNotificationResponse).not.toHaveBeenCalled();
});
