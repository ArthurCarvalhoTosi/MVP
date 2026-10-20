import { act, render, screen, userEvent } from '@testing-library/react-native';
import type { Account as AccountState } from '@/account';
import { signInWithGoogle, signOut } from '@/account';
import Account from '@/app/account';
import type { Db } from '@/db/client';
import { ValidationError } from '@/domain';
import { syncNow, type SyncStatus } from '@/sync/useSync';
import { router, seedVehicle, setupScreen, spyAlert } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);

let mockAccount: AccountState = { status: 'signed-out' };
jest.mock('@/account', () => ({
  useAccount: () => mockAccount,
  signInWithGoogle: jest.fn(async () => 'signed-in'),
  signOut: jest.fn(async () => {}),
}));

let mockSync: SyncStatus = { state: 'idle', lastSyncAt: null };
jest.mock('@/sync/useSync', () => ({
  useSyncStatus: () => mockSync,
  syncNow: jest.fn(),
}));

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
  mockAccount = { status: 'signed-out' };
  mockSync = { state: 'idle', lastSyncAt: null };
});

test('signed out: explains the optional account and signs in with Google', async () => {
  await render(<Account />);
  expect(screen.getByText(/guardar uma cópia dos seus dados na nuvem/)).toBeOnTheScreen();
  expect(
    screen.getByText('É opcional. Sem conta, tudo continua só neste aparelho.'),
  ).toBeOnTheScreen();

  await userEvent.setup().press(screen.getByRole('button', { name: 'Continuar com o Google' }));
  expect(signInWithGoogle).toHaveBeenCalledWith(db);
});

test('a second tap while signing in is ignored', async () => {
  let finish: (r: 'signed-in') => void = () => {};
  (signInWithGoogle as jest.Mock).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  await render(<Account />);
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Continuar com o Google' });

  await user.press(button);
  await user.press(button);
  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  await act(async () => finish('signed-in'));
});

test('shows the plain message when signing in fails, and nothing when cancelled', async () => {
  (signInWithGoogle as jest.Mock)
    .mockRejectedValueOnce(
      new ValidationError('Não foi possível entrar. Confira a internet e tente de novo.'),
    )
    .mockResolvedValueOnce('cancelled');
  await render(<Account />);
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Continuar com o Google' });

  await user.press(button);
  expect(
    screen.getByText('Não foi possível entrar. Confira a internet e tente de novo.'),
  ).toBeOnTheScreen();

  await user.press(button);
  expect(screen.queryByText(/Não foi possível/)).toBeNull();
});

test('signed in: shows the account and signs out after confirming', async () => {
  mockAccount = { status: 'signed-in', email: 'ana@example.com' };
  const { alert, press } = spyAlert();
  await render(<Account />);
  expect(screen.getByText('Conectado como ana@example.com.')).toBeOnTheScreen();

  await userEvent.setup().press(screen.getByRole('button', { name: 'Sair da conta' }));
  expect(alert).toHaveBeenLastCalledWith(
    'Sair da conta?',
    'Seus carros e o histórico continuam neste aparelho.',
    expect.any(Array),
  );
  expect(signOut).not.toHaveBeenCalled();

  await press('Sair');
  expect(signOut).toHaveBeenCalledWith(db);
});

test('renders nothing while the stored session loads', async () => {
  mockAccount = { status: 'loading' };
  await render(<Account />);
  expect(screen.toJSON()).toBeNull();
});

describe('signed in: sync status', () => {
  beforeEach(() => {
    mockAccount = { status: 'signed-in', email: 'ana@example.com' };
  });

  test.each<[SyncStatus, RegExp]>([
    [{ state: 'idle', lastSyncAt: null }, /^Seus dados ainda não foram para a nuvem\.$/],
    [{ state: 'syncing', lastSyncAt: null }, /^Sincronizando…$/],
    [{ state: 'failed', lastSyncAt: null }, /^Não foi possível sincronizar agora\./],
    [
      { state: 'idle', lastSyncAt: new Date().toISOString() },
      /^Dados na nuvem: sincronizado hoje às \d\d:\d\d\.$/,
    ],
  ])('%j reads %s', async (sync, line) => {
    mockSync = sync;
    await render(<Account />);
    expect(screen.getByText(line)).toBeOnTheScreen();
  });

  test('syncs on request, and shows it busy while syncing', async () => {
    await render(<Account />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Sincronizar agora' }));
    expect(syncNow).toHaveBeenCalledTimes(1);

    mockSync = { state: 'syncing', lastSyncAt: null };
    await render(<Account />);
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeBusy();
  });
});

describe('opened from a new phone (no cars yet)', () => {
  test("goes to the garage once the account's cars land", async () => {
    const view = await render(<Account />);
    mockAccount = { status: 'signed-in', email: 'ana@example.com' };
    await view.rerender(<Account />);
    expect(router.dismissTo).not.toHaveBeenCalled(); // signed in, nothing synced yet

    await seedVehicle(db); // what the first sync lands
    await view.rerender(<Account />);
    expect(router.dismissTo).toHaveBeenCalledWith('/');
  });

  test('an account with no cars stays here', async () => {
    mockAccount = { status: 'signed-in', email: 'ana@example.com' };
    await render(<Account />);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  test('opened from a garage that already has cars, it never navigates', async () => {
    await seedVehicle(db);
    mockAccount = { status: 'signed-in', email: 'ana@example.com' };
    await render(<Account />);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});
