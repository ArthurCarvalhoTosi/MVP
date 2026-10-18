import { render, screen, userEvent } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import Backup from '@/app/backup';
import { createBackupFile } from '@/backup';
import type { Db } from '@/db/client';
import { todayISO } from '@/domain';
import { router, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
const mockFile = { uri: 'file:///cache/Garagem-backup.bkp', exists: true, delete: jest.fn() };
jest.mock('@/backup', () => ({ MIN_PASSWORD: 8, createBackupFile: jest.fn(async () => mockFile) }));

const createMock = createBackupFile as jest.Mock;
const shareMock = Sharing.shareAsync as jest.Mock;
let db: Db;

beforeEach(async () => {
  db = await setupScreen();
});

async function fill(password: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Senha do backup'), password);
  await user.type(screen.getByLabelText('Repita a senha'), confirm);
  await user.press(screen.getByRole('button', { name: 'Criar backup' }));
}

test('creates the file with the password, shares it, deletes the copy and closes', async () => {
  await render(<Backup />);
  expect(screen.getByRole('header', { name: 'Fazer backup' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Senha do backup')).toHaveProp('secureTextEntry', true);

  await fill('minha senha', 'minha senha');

  expect(createMock).toHaveBeenCalledWith(db, 'minha senha', todayISO());
  expect(shareMock).toHaveBeenCalledWith(mockFile.uri, expect.objectContaining({ dialogTitle: 'Salvar backup' }));
  expect(mockFile.delete).toHaveBeenCalled();
  expect(router.back).toHaveBeenCalled();
});

test('asks for a long enough password, typed the same twice', async () => {
  await render(<Backup />);

  await fill('curta', 'curta');
  expect(screen.getByText('Use pelo menos 8 caracteres.')).toBeOnTheScreen();

  await userEvent.setup().clear(screen.getByLabelText('Senha do backup'));
  await fill('senha longa', 'outra');
  expect(screen.getByText('As duas senhas não são iguais.')).toBeOnTheScreen();
  expect(createMock).not.toHaveBeenCalled();
});

test('a failure reads plainly and keeps the sheet open', async () => {
  createMock.mockRejectedValueOnce(new Error('ENOSPC'));
  await render(<Backup />);

  await fill('minha senha', 'minha senha');

  expect(screen.getByText('Não foi possível salvar. Tente de novo.')).toBeOnTheScreen();
  expect(router.back).not.toHaveBeenCalled();
});
