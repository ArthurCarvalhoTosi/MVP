import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import type { Account } from '@/account';
import Dossier from '@/app/dossier';
import type { Db } from '@/db/client';
import { registerMaintenance } from '@/db/repo';
import { createDossierLink, deleteDossierLink, listDossierLinks } from '@/dossier-link';
import { addDays, formatBRL, formatDate, todayISO } from '@/domain';
import {
  attachmentsMock,
  params,
  redirect,
  router,
  seedVehicle,
  setupScreen,
  spyAlert,
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

let mockAccount: Account = { status: 'signed-out' };
jest.mock('@/account', () => ({ useAccount: () => mockAccount }));
jest.mock('@/dossier-link', () => ({
  createDossierLink: jest.fn(),
  listDossierLinks: jest.fn(),
  deleteDossierLink: jest.fn(),
}));
const URL = 'https://garagem.acttechsoftware.com.br/d#AAAAAAAAAAAAAAAAAAAAAA';

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

const createMock = createDossierLink as jest.Mock;
const listMock = listDossierLinks as jest.Mock;
const shareLinkMock = jest.spyOn(Share, 'share');

beforeEach(async () => {
  mockDisk.clear();
  db = await setupScreen();
  mockAccount = { status: 'signed-out' };
  createMock.mockResolvedValue(URL);
  listMock.mockResolvedValue([]);
  (deleteDossierLink as jest.Mock).mockResolvedValue(undefined);
  shareLinkMock.mockResolvedValue({ action: 'sharedAction', activityType: undefined });
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

describe('link', () => {
  const DAY = 86_400_000;
  const signIn = () => (mockAccount = { status: 'signed-in', email: 'ana@example.com' });

  test('signed out: points to the account first', async () => {
    await render(<Dossier />);
    expect(screen.getByText('Para criar um link, entre na sua conta.')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Entrar na conta' }));
    expect(router.replace).toHaveBeenCalledWith('/account');
    expect(listMock).not.toHaveBeenCalled();
  });

  test('creates a 30-day link without photos or notes and hands it to the share sheet', async () => {
    signIn();
    await log(PHOTO);
    await render(<Dossier />);
    const user = userEvent.setup();
    // Photos on for the PDF must not leak into the link.
    await user.press(screen.getByRole('radio', { name: 'Sim' }));
    expect(screen.getByRole('radio', { name: '30 dias' })).toBeChecked();

    const before = Date.now();
    await user.press(screen.getByRole('button', { name: 'Criar e enviar link' }));

    const [, carId, html, expiresAt] = createMock.mock.calls[0];
    expect(carId).toBe(vehicleId);
    expect(html).toContain('40.800 km');
    expect(html).toContain('Com comprovante');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Ligar para o mecânico');
    expect(attachmentsMock.readPhoto).not.toHaveBeenCalled();
    const expires = new Date(expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 30 * DAY);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY);
    expect(shareLinkMock).toHaveBeenCalledWith({
      message: `Histórico de manutenção: Meu Sandero\n${URL}`,
    });
    // Listed on open and again after creating.
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  test('"Sem prazo" makes a link that never expires', async () => {
    signIn();
    await render(<Dossier />);
    const user = userEvent.setup();
    await user.press(screen.getByRole('radio', { name: 'Sem prazo' }));
    await user.press(screen.getByRole('button', { name: 'Criar e enviar link' }));
    expect(createMock.mock.calls[0][3]).toBeNull();
  });

  test('a failure is explained plainly and nothing is shared', async () => {
    signIn();
    createMock.mockRejectedValueOnce(new Error('create dossier link: 42501'));
    await render(<Dossier />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Criar e enviar link' }));
    expect(
      screen.getByText('Não foi possível criar o link. Confira a internet e tente de novo.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/42501/)).not.toBeOnTheScreen();
    expect(shareLinkMock).not.toHaveBeenCalled();
  });

  test('a second tap while creating is ignored', async () => {
    signIn();
    let finish: (url: string) => void = () => {};
    createMock.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await render(<Dossier />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Criar e enviar link' });
    await user.press(button);
    await user.press(button);
    expect(createMock).toHaveBeenCalledTimes(1);
    finish(URL);
    await waitFor(() => expect(shareLinkMock).toHaveBeenCalled());
  });

  test('lists the live links and deactivates one after confirming', async () => {
    signIn();
    const created = '2026-10-21T12:00:00.000Z';
    const expires = '2026-11-20T12:00:00.000Z';
    listMock.mockResolvedValue([
      { id: 'a', createdAt: created, expiresAt: expires },
      { id: 'b', createdAt: created, expiresAt: null },
    ]);
    const { alert, press } = spyAlert();
    await render(<Dossier />);

    const day = (t: string) => formatDate(todayISO(new Date(t)));
    const first = `Criado em ${day(created)}, funciona até ${day(expires)}`;
    expect(await screen.findByText(first)).toBeOnTheScreen();
    expect(screen.getByText(`Criado em ${day(created)}, sem prazo`)).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: `Desativar link. ${first}` }));
    expect(alert).toHaveBeenLastCalledWith(
      'Desativar este link?',
      'Quem recebeu o link não vai mais conseguir abrir o histórico.',
      expect.any(Array),
    );
    listMock.mockResolvedValue([{ id: 'b', createdAt: created, expiresAt: null }]);
    await press('Desativar');
    expect(deleteDossierLink).toHaveBeenCalledWith(db, 'a');
    await waitFor(() => expect(screen.queryByText(first)).not.toBeOnTheScreen());
  });

  test('says so when the links cannot be loaded', async () => {
    signIn();
    listMock.mockRejectedValue(new Error('offline'));
    await render(<Dossier />);
    expect(
      await screen.findByText('Não foi possível carregar os links ativos agora.'),
    ).toBeOnTheScreen();
  });
});
