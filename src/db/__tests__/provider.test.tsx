import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert, Text, type AlertButton } from 'react-native';
import {
  DatabaseKeyError,
  EncryptionUnavailableError,
  openDatabase,
  resetDatabase,
  type Db,
} from '../client';
import { DatabaseProvider, useDb } from '../provider';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  openDatabase: jest.fn(),
  resetDatabase: jest.fn(async () => {}),
}));

// Native layer behind the real openDatabase in the end-to-end key cases: SQLCipher is present,
// but the first read of the file fails.
let mockStoredKey: string | null = null;
const mockUnreadableFile = {
  execSync: jest.fn(),
  getFirstSync: jest.fn((sql: string) => {
    if (sql === 'PRAGMA cipher_version') return { cipher_version: '4.6.1 community' };
    throw new Error('file is not a database');
  }),
  closeSync: jest.fn(),
};
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => mockUnreadableFile,
  deleteDatabaseSync: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: async () => mockStoredKey,
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n) }));

// The provider caches the open promise per module, as in the app. Each test ends with a failed open
// (which clears the cache) except the last, so tests run in this order on purpose.

const fakeDb = { fake: true } as unknown as Db;
const open = jest.mocked(openDatabase);
const reset = jest.mocked(resetDatabase);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Child() {
  useDb();
  return <Text>app</Text>;
}

let alertButtons: AlertButton[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  alertButtons = [];
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    alertButtons = buttons ?? [];
  });
});

async function renderProvider(onSettled = jest.fn()) {
  await render(
    <DatabaseProvider onSettled={onSettled}>
      <Child />
    </DatabaseProvider>,
  );
  return onSettled;
}

test('two concurrent providers share one open, so a first launch generates one key', async () => {
  const pending = deferred<Db>();
  open.mockReturnValueOnce(pending.promise);
  const settled = [jest.fn(), jest.fn()];

  await render(
    <>
      <DatabaseProvider onSettled={settled[0]}>
        <Child />
      </DatabaseProvider>
      <DatabaseProvider onSettled={settled[1]}>
        <Child />
      </DatabaseProvider>
    </>,
  );
  expect(settled[0]).not.toHaveBeenCalled();
  await act(async () => pending.reject(new Error('boom')));

  expect(open).toHaveBeenCalledTimes(1);
  expect(settled[0]).toHaveBeenCalledTimes(1);
  expect(settled[1]).toHaveBeenCalledTimes(1);
});

test('a generic failure shows a pt-BR message, never the raw error, and settles once', async () => {
  open.mockRejectedValueOnce(new Error('SQLITE_IOERR: disk I/O error'));

  const onSettled = await renderProvider();

  expect(
    screen.getByText('Não foi possível abrir seus dados. Feche e abra o app de novo.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/SQLITE/)).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test('a failed open is retried by the next mount', async () => {
  open.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));

  await renderProvider();
  await screen.unmount();
  await renderProvider();

  expect(open).toHaveBeenCalledTimes(2);
});

test('missing encryption shows its own message', async () => {
  open.mockRejectedValueOnce(new EncryptionUnavailableError());

  await renderProvider();

  expect(
    screen.getByText('A criptografia do banco não está disponível nesta versão do app.'),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
});

test('a key error offers the reset, which deletes nothing when the user cancels', async () => {
  open.mockRejectedValueOnce(new DatabaseKeyError('Database key missing or wrong'));

  await renderProvider();
  expect(screen.getByText(/a chave de segurança deles não foi encontrada/)).toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Apagar dados e começar de novo' }));

  expect(Alert.alert).toHaveBeenCalledWith(
    'Apagar dados?',
    'Os registros salvos neste aparelho não podem ser lidos sem a chave original e serão apagados. Isso não pode ser desfeito.',
    expect.any(Array),
  );
  expect(alertButtons.map((b) => [b.text, b.style])).toEqual([
    ['Cancelar', 'cancel'],
    ['Apagar', 'destructive'],
  ]);
  expect(alertButtons[0].onPress).toBeUndefined();
  expect(reset).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
});

test.each([
  ['a stored key: the data may be intact, so no reset', 'f'.repeat(64), false],
  ['no stored key (iOS restore): the reset is offered', null, true],
])('real openDatabase, unreadable file with %s', async (_, key, offersReset) => {
  mockStoredKey = key;
  open.mockImplementationOnce(
    jest.requireActual<typeof import('../client')>('../client').openDatabase,
  );

  await renderProvider();

  const resetButton = screen.queryByRole('button', { name: 'Apagar dados e começar de novo' });
  expect(resetButton !== null).toBe(offersReset);
  if (!offersReset) {
    expect(
      screen.getByText('Não foi possível abrir seus dados. Feche e abra o app de novo.'),
    ).toBeOnTheScreen();
  }
  expect(mockUnreadableFile.closeSync).toHaveBeenCalledTimes(1);
});

test('confirming the reset deletes the data and opens a fresh database (keep last: caches the open)', async () => {
  open
    .mockRejectedValueOnce(new DatabaseKeyError('Database key missing or wrong'))
    .mockResolvedValueOnce(fakeDb);

  const onSettled = await renderProvider();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Apagar dados e começar de novo' }));
  expect(reset).not.toHaveBeenCalled();
  await act(async () => alertButtons.find((b) => b.text === 'Apagar')!.onPress!());

  expect(reset).toHaveBeenCalledTimes(1);
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[1]);
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.getByText('app')).toBeOnTheScreen();
  expect(onSettled).toHaveBeenCalledTimes(1); // the splash was already hidden by the error screen
});
