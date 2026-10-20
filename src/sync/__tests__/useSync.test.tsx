import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { Db } from '@/db/client';
import { writeSyncPref } from '@/db/sync';
import { createTestDb } from '@/db/test-utils/testDb';
import { syncOnce } from '..';
import { syncNow, useSync, useSyncStatus } from '../useSync';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());

let mockSession: object | null = { user: { email: 'ana@example.com' } };
let mockAuthListener: (event: string) => void = () => {};
let mockChangeListener: (e: { tableName: string }) => void = () => {};
jest.mock('@/account', () => ({
  cloud: () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      onAuthStateChange: (cb: (event: string) => void) => {
        mockAuthListener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  }),
  dataKey: jest.fn(async () => 'KEY'),
}));
jest.mock('expo-sqlite', () => ({
  addDatabaseChangeListener: (cb: (e: { tableName: string }) => void) => {
    mockChangeListener = cb;
    return { remove: jest.fn() };
  },
}));
jest.mock('../remote', () => ({ supabaseRemote: () => 'REMOTE' }));
jest.mock('..', () => ({
  ...jest.requireActual('..'),
  syncOnce: jest.fn(async (db: Db) => {
    require('@/db/sync').writeSyncPref(db, 'lastSyncAt', '2026-10-20T14:32:00.000Z');
    return { pulled: 0, pushed: 0, skipped: 0 };
  }),
}));

let db: Db;
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSession = { user: { email: 'ana@example.com' } };
  db = await createTestDb();
});
afterEach(() => jest.useRealTimers());

function mount() {
  return renderHook(() => {
    useSync(db);
    return useSyncStatus();
  });
}

const settle = () => act(async () => jest.runOnlyPendingTimersAsync());

test('starts from the last sync stored on this phone', async () => {
  writeSyncPref(db, 'lastSyncAt', '2026-10-19T10:00:00.000Z');
  const { result } = await mount();
  expect(result.current).toEqual({ state: 'idle', lastSyncAt: '2026-10-19T10:00:00.000Z' });
});

test('syncs on opening and after signing in, with the data key', async () => {
  const { result } = await mount();
  await act(async () => mockAuthListener('INITIAL_SESSION'));
  await settle();
  expect(syncOnce).toHaveBeenCalledWith(db, 'REMOTE', 'KEY');
  expect(result.current).toEqual({ state: 'idle', lastSyncAt: '2026-10-20T14:32:00.000Z' });

  await act(async () => mockAuthListener('SIGNED_IN'));
  await settle();
  expect(syncOnce).toHaveBeenCalledTimes(2);
});

test('signed out: never syncs', async () => {
  mockSession = null;
  await mount();
  await act(async () => mockAuthListener('INITIAL_SESSION'));
  await settle();
  await act(async () => syncNow());
  await settle();
  expect(syncOnce).not.toHaveBeenCalled();
});

test('a failure shows as failed and logs only the message', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (syncOnce as jest.Mock).mockRejectedValueOnce(new Error('sync push failed: 500'));
  const { result } = await mount();
  await act(async () => syncNow());
  await settle();
  expect(result.current.state).toBe('failed');
  expect(warn).toHaveBeenCalledWith('sync failed:', 'sync push failed: 500');
  warn.mockRestore();
});

test('edits to synced tables upload after a pause; bookkeeping tables do not', async () => {
  await mount();
  await act(async () => {
    mockChangeListener({ tableName: 'device_prefs' });
    mockChangeListener({ tableName: 'sync_state' });
  });
  await act(async () => jest.advanceTimersByTimeAsync(5000));
  expect(syncOnce).not.toHaveBeenCalled();

  await act(async () => mockChangeListener({ tableName: 'maintenance_logs' }));
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  await act(async () => mockChangeListener({ tableName: 'odometer_readings' }));
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(syncOnce).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(syncOnce).toHaveBeenCalledTimes(1);
});

test('coming back to the app syncs', async () => {
  const listeners: ((s: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    listeners.push(cb as (s: string) => void);
    return { remove: jest.fn() } as never;
  });
  await mount();
  await act(async () => listeners.forEach((l) => l('background')));
  await settle();
  expect(syncOnce).not.toHaveBeenCalled();
  await act(async () => listeners.forEach((l) => l('active')));
  await settle();
  expect(syncOnce).toHaveBeenCalledTimes(1);
});

test('signing out clears the status', async () => {
  const { result } = await mount();
  await act(async () => syncNow());
  await settle();
  expect(result.current.lastSyncAt).not.toBeNull();
  await act(async () => mockAuthListener('SIGNED_OUT'));
  expect(result.current).toEqual({ state: 'idle', lastSyncAt: null });
});
