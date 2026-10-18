import { render, screen, userEvent } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import Dossier from '@/app/dossier';
import type { Db } from '@/db/client';
import { registerMaintenance } from '@/db/repo';
import { addDays, formatBRL, todayISO } from '@/domain';
import {
  attachmentsMock,
  params,
  redirect,
  router,
  seedVehicle,
  setupScreen,
} from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('@/attachments', () => require('@/test-utils/screens').attachmentsMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async () => ({ uri: 'file:///cache/Print/abc.pdf' })),
}));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));

// Files live in a Set so a test can tell what is still on "mockDisk".
const mockDisk = new Set<string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
      if (parts.length === 1) mockDisk.add(this.uri);
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    async move(to: File) {
      mockDisk.delete(this.uri);
      mockDisk.add(to.uri);
      this.uri = to.uri;
    }
    delete() {
      mockDisk.delete(this.uri);
    }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } };
});

const printMock = Print.printToFileAsync as jest.Mock;
const shareMock = Sharing.shareAsync as jest.Mock;
const PHOTO = { filePath: 'attachments/a.bin', mime: 'image/jpeg', sizeBytes: 1 };
const lastHtml = () => printMock.mock.calls.at(-1)[0].html as string;

let db: Db;
let vehicleId: string;
let oilId: string;

beforeEach(async () => {
  mockDisk.clear();
  db = await setupScreen();
  ({ vehicleId, oilId } = await seedVehicle(db, addDays(todayISO(), -30)));
  params.vehicleId = vehicleId;
});

const log = (attachment?: typeof PHOTO) =>
  registerMaintenance(db, {
    vehicleId,
    itemId: oilId,
    performedAt: addDays(todayISO(), -2),
    km: 40800,
    costCents: 19900,
    notes: 'Ligar para o mecânico',
    attachment,
  });

test('shares a PDF named after the car, without notes, then deletes it and closes', async () => {
  await log();
  await render(<Dossier />);

  expect(screen.getByRole('header', { name: 'Histórico em PDF' })).toBeOnTheScreen();
  expect(screen.queryByText('Incluir as fotos dos comprovantes?')).not.toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Gerar e enviar PDF' }));

  const html = lastHtml();
  expect(html).toContain('Meu Sandero');
  expect(html).toContain('40.800 km');
  expect(html).toContain(formatBRL(19900));
  expect(html).toContain('Registrado no app depois');
  expect(html).not.toContain('Ligar para o mecânico');
  const file = `file:///cache/Historico-Meu-Sandero-${todayISO()}.pdf`;
  expect(shareMock).toHaveBeenCalledWith(
    file,
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
  expect(mockDisk.size).toBe(0);
  expect(router.back).toHaveBeenCalled();
});

test('leaves receipt photos out unless the owner opts in, warning about what they show', async () => {
  await log(PHOTO);
  await render(<Dossier />);
  const user = userEvent.setup();

  expect(screen.getByRole('radio', { name: 'Não' })).toBeChecked();
  await user.press(screen.getByRole('button', { name: 'Gerar e enviar PDF' }));
  expect(attachmentsMock.readPhoto).not.toHaveBeenCalled();
  expect(lastHtml()).toContain('Com comprovante');
  expect(lastHtml()).not.toContain('<img');

  await user.press(screen.getByRole('radio', { name: 'Sim' }));
  expect(
    screen.getByText(
      'Notas fiscais costumam mostrar CPF e endereço. Confira as fotos antes de enviar.',
    ),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Gerar e enviar PDF' }));
  expect(attachmentsMock.readPhoto).toHaveBeenCalledWith(PHOTO.filePath);
  expect(lastHtml()).toContain('data:image/jpeg;base64,SAVED');
});

test('explains a failure plainly, stays open and leaves no file behind', async () => {
  await log();
  shareMock.mockRejectedValueOnce(new Error('Activity not found'));
  await render(<Dossier />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Gerar e enviar PDF' }));

  expect(screen.getByText('Não foi possível gerar o PDF. Tente de novo.')).toBeOnTheScreen();
  expect(screen.queryByText(/Activity/)).not.toBeOnTheScreen();
  expect(mockDisk.size).toBe(0);
  expect(router.back).not.toHaveBeenCalled();
});

test('leaves for the garage when the car is gone', async () => {
  params.vehicleId = 'missing';
  await render(<Dossier />);
  expect(redirect).toHaveBeenCalledWith('/');
});
