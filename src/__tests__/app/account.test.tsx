import { act, render, screen, userEvent } from '@testing-library/react-native';
import type { Account as AccountState } from '@/account';
import { signInWithGoogle, signOut } from '@/account';
import Account from '@/app/account';
import type { Db } from '@/db/client';
import { ValidationError } from '@/domain';
import { setupScreen, spyAlert } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);

let mockAccount: AccountState = { status: 'signed-out' };
jest.mock('@/account', () => ({
  useAccount: () => mockAccount,
  signInWithGoogle: jest.fn(async () => 'signed-in'),
  signOut: jest.fn(async () => {}),
}));

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
  mockAccount = { status: 'signed-out' };
});

test('signed out: explains the optional account and signs in with Google', async () => {
  await render(<Account />);
  expect(screen.getByText(/guardar uma cópia dos seus dados na nuvem/)).toBeOnTheScreen();
  expect(
    screen.getByText('É opcional. Sem conta, tudo continua só neste aparelho.'),
  ).toBeOnTheScreen();

  await userEvent.setup().press(screen.getByRole('button', { name: 'Entrar com Google' }));
  expect(signInWithGoogle).toHaveBeenCalledWith(db);
});

test('a second tap while signing in is ignored', async () => {
  let finish: (r: 'signed-in') => void = () => {};
  (signInWithGoogle as jest.Mock).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  await render(<Account />);
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Entrar com Google' });

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
  const button = screen.getByRole('button', { name: 'Entrar com Google' });

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
