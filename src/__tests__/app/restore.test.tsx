import { render, screen, userEvent } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import Restore from '@/app/restore';
import { readBackupFile, restoreBackup } from '@/backup';
import type { Db } from '@/db/client';
import { ValidationError } from '@/domain';
import { router, seedVehicle, setupScreen, spyAlert } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({
  File: class {
    delete() {
      mockDelete();
    }
  },
}));
const mockBackup = { rows: {}, photos: {} };
jest.mock('@/backup', () => ({
  readBackupFile: jest.fn(async () => mockBackup),
  restoreBackup: jest.fn(async () => {}),
}));

const pickMock = DocumentPicker.getDocumentAsync as jest.Mock;
const readMock = readBackupFile as jest.Mock;
const FILE = { uri: 'file:///cache/DocumentPicker/x.bkp', name: 'Garagem-backup-2026-10-17.bkp' };
let db: Db;

beforeEach(async () => {
  db = await setupScreen();
  pickMock.mockResolvedValue({ canceled: false, assets: [FILE] });
});

async function chooseAndType(password: string) {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Escolher arquivo' }));
  await user.type(screen.getByLabelText('Senha do backup'), password);
  await user.press(screen.getByRole('button', { name: 'Restaurar' }));
}

test('on a fresh phone restores right away and opens the garage', async () => {
  await render(<Restore />);
  expect(screen.getByText('Nenhum arquivo escolhido')).toBeOnTheScreen();

  await chooseAndType('minha senha');

  expect(screen.getByText(FILE.name)).toBeOnTheScreen();
  expect(readMock).toHaveBeenCalledWith(FILE.uri, 'minha senha');
  expect(restoreBackup).toHaveBeenCalledWith(db, mockBackup);
  expect(mockDelete).toHaveBeenCalled();
  expect(router.dismissTo).toHaveBeenCalledWith('/');
});

test('asks before replacing cars already on the phone', async () => {
  await seedVehicle(db);
  const { alert, press } = spyAlert();
  await render(<Restore />);

  await chooseAndType('minha senha');
  expect(alert.mock.calls[0][0]).toBe('Substituir os dados deste aparelho?');
  expect(restoreBackup).not.toHaveBeenCalled();

  await press('Substituir');
  expect(restoreBackup).toHaveBeenCalled();
});

test('asks for the file and the password first', async () => {
  await render(<Restore />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Restaurar' }));

  expect(screen.getByText('Escolha o arquivo do backup.')).toBeOnTheScreen();
  expect(screen.getByText('Digite a senha do backup.')).toBeOnTheScreen();
  expect(readMock).not.toHaveBeenCalled();
});

test('a wrong password says so and lets the user try again', async () => {
  readMock.mockRejectedValueOnce(new ValidationError('Senha errada ou arquivo danificado.'));
  await render(<Restore />);

  await chooseAndType('errada');

  expect(screen.getByText('Senha errada ou arquivo danificado.')).toBeOnTheScreen();
  expect(router.dismissTo).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Restaurar' })).toBeEnabled();
});

test('a cancelled pick changes nothing', async () => {
  pickMock.mockResolvedValueOnce({ canceled: true, assets: null });
  await render(<Restore />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Escolher arquivo' }));

  expect(screen.getByText('Nenhum arquivo escolhido')).toBeOnTheScreen();
});
