import { render, screen, userEvent } from '@testing-library/react-native';
import History from '@/app/history';
import type { Db } from '@/db/client';
import * as repo from '@/db/repo';
import { itemsQuery, logsQuery, readingsQuery, registerMaintenance } from '@/db/repo';
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
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('@/attachments', () => require('@/test-utils/screens').attachmentsMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

let db: Db;
let vehicleId: string;
let oilId: string;
const since = addDays(todayISO(), -60);

beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId, oilId } = await seedVehicle(db, since));
  params.vehicleId = vehicleId;
});

test('invites the first record when there is no history', async () => {
  await render(<History />);

  expect(
    screen.getByText(
      'Nenhuma troca registrada ainda. Quando você registrar a primeira, ela aparece aqui.',
    ),
  ).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Voltar para a garagem' }));
  expect(router.dismissTo).toHaveBeenCalledWith('/');
});

test('shows the total spent and a reverse timeline, flagging late records', async () => {
  const yesterday = addDays(todayISO(), -1);
  const log = (performedAt: string, km: number, costCents: number | null, brandSpec?: string) =>
    registerMaintenance(db, { vehicleId, itemId: oilId, performedAt, km, costCents, brandSpec });
  await log(addDays(since, 10), 40500, 15000, 'Mobil 5W-30');
  await log(yesterday, 41900, 5050);
  await log(todayISO(), 42000, null);

  await render(<History />);

  expect(screen.getByText('Total gasto em manutenção')).toBeOnTheScreen();
  expect(screen.getByText(formatBRL(20050))).toBeOnTheScreen();
  expect(screen.getByText('3 trocas registradas')).toBeOnTheScreen();
  expect(screen.getByText('Mobil 5W-30')).toBeOnTheScreen();

  const dates = screen.getAllByText(/ · .* km$/).map((t) => t.props.children);
  expect(dates).toEqual([
    `${formatDate(todayISO())} · 42.000 km`,
    `${formatDate(yesterday)} · 41.900 km`,
    `${formatDate(addDays(since, 10))} · 40.500 km`,
  ]);
  // Logged today for earlier dates: two late records, the same-day one isn't flagged.
  expect(screen.getAllByText(`Registrado em ${formatDate(todayISO())}`)).toHaveLength(2);
});

test('opens the PDF export for this car', async () => {
  await registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: todayISO(), km: 42000 });
  await render(<History />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Exportar histórico em PDF' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/dossier', params: { vehicleId } });
});

test("shows the history of the car it was opened for, not the first one's", async () => {
  await registerMaintenance(db, {
    vehicleId,
    itemId: oilId,
    performedAt: todayISO(),
    km: 42000,
    costCents: 9900,
  });
  const gol = await seedVehicle(db, since, { nickname: 'Meu Gol', odometerKm: 80000 });
  await registerMaintenance(db, {
    vehicleId: gol.vehicleId,
    itemId: gol.oilId,
    performedAt: todayISO(),
    km: 82000,
    costCents: 15000,
  });
  params.vehicleId = gol.vehicleId;
  await render(<History />);

  expect(screen.getByText('1 troca registrada')).toBeOnTheScreen();
  expect(screen.getByText(`${formatDate(todayISO())} · 82.000 km`)).toBeOnTheScreen();
  expect(screen.queryByText(/42\.000 km/)).not.toBeOnTheScreen();
});

test('leaves for the garage when the car is gone', async () => {
  params.vehicleId = 'missing';
  await render(<History />);
  expect(redirect).toHaveBeenCalledWith('/');
});

describe('a record', () => {
  const day = addDays(todayISO(), -5);
  const WHAT = `Troca de óleo e filtro de ${formatDate(day)}`;
  const PHOTO = { filePath: 'attachments/a.bin', mime: 'image/jpeg', sizeBytes: 1 };

  const seedLog = (attachment?: typeof PHOTO) =>
    registerMaintenance(db, {
      vehicleId,
      itemId: oilId,
      performedAt: day,
      km: 41500,
      notes: 'Oficina do bairro',
      attachment,
    });

  test('shows its notes and opens for editing', async () => {
    await seedLog();
    await render(<History />);

    expect(screen.getByText('Oficina do bairro')).toBeOnTheScreen();
    expect(screen.queryByText('Com comprovante')).not.toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: `Editar ${WHAT}` }));

    const [log] = logsQuery(db, vehicleId).all();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/register',
      params: { vehicleId, logId: log.id },
    });
  });

  test('with a photo says so and shows it decrypted on demand', async () => {
    await seedLog(PHOTO);
    await render(<History />);
    const user = userEvent.setup();

    expect(screen.getByText('Com comprovante')).toBeOnTheScreen();
    expect(attachmentsMock.readPhoto).not.toHaveBeenCalled();
    const show = screen.getByRole('button', { name: `Ver foto do comprovante de ${WHAT}` });
    expect(show).toBeCollapsed();

    await user.press(show);

    expect(attachmentsMock.readPhoto).toHaveBeenCalledWith(PHOTO.filePath);
    expect(screen.getByRole('image', { name: `Foto do comprovante de ${WHAT}` })).toHaveProp(
      'source',
      [{ uri: 'data:image/jpeg;base64,SAVED' }],
    );
    const hide = screen.getByRole('button', { name: `Ocultar foto do comprovante de ${WHAT}` });
    expect(hide).toBeExpanded();
    await user.press(hide);
    expect(screen.queryByRole('image')).not.toBeOnTheScreen();
  });

  test('explains a photo that could not be opened', async () => {
    attachmentsMock.readPhoto.mockRejectedValueOnce(new Error('bad tag'));
    await seedLog(PHOTO);
    await render(<History />);

    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: `Ver foto do comprovante de ${WHAT}` }));

    expect(screen.getByText('Não foi possível abrir a foto. Tente de novo.')).toBeOnTheScreen();
  });

  test('is deleted only after confirming, with its reading, and the baseline goes back', async () => {
    await seedLog(PHOTO);
    const { alert, press } = spyAlert();
    await render(<History />);

    await userEvent.setup().press(screen.getByRole('button', { name: `Excluir ${WHAT}` }));
    expect(alert).toHaveBeenCalledWith(
      'Excluir esta troca?',
      `Troca de óleo e filtro, ${formatDate(day)}. O registro e a foto do comprovante serão apagados deste aparelho. Isso não pode ser desfeito.`,
      [
        expect.objectContaining({ text: 'Cancelar', style: 'cancel' }),
        expect.objectContaining({ text: 'Excluir', style: 'destructive' }),
      ],
    );
    expect(logsQuery(db, vehicleId).all()).toHaveLength(1);
    await press('Excluir');

    expect(logsQuery(db, vehicleId).all()).toEqual([]);
    expect(readingsQuery(db, vehicleId).all()).toEqual([{ km: 40000, readAt: since }]);
    expect(itemsQuery(db, vehicleId).all()[0]).toMatchObject({
      baselineKm: 40000,
      baselineDate: since,
    });
    expect(attachmentsMock.deleteRemovedPhotos).toHaveBeenCalled();
    await screen.rerender(<History />);
    expect(screen.getByText(/^Nenhuma troca registrada ainda/)).toBeOnTheScreen();
  });

  test('stays when the deletion is cancelled, and a failure reads plainly', async () => {
    await seedLog();
    const { alert, press } = spyAlert();
    await render(<History />);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: `Excluir ${WHAT}` }));
    expect(alert.mock.calls[0][1]).toBe(
      `Troca de óleo e filtro, ${formatDate(day)}. O registro será apagado deste aparelho. Isso não pode ser desfeito.`,
    );
    await press('Cancelar');
    expect(logsQuery(db, vehicleId).all()).toHaveLength(1);

    const remove = jest
      .spyOn(repo, 'removeMaintenance')
      .mockRejectedValueOnce(new Error('disk I/O error'));
    await user.press(screen.getByRole('button', { name: `Excluir ${WHAT}` }));
    await press('Excluir');
    expect(screen.getByText('Não foi possível salvar. Tente de novo.')).toBeOnTheScreen();
    expect(logsQuery(db, vehicleId).all()).toHaveLength(1);
    remove.mockRestore();
  });
});
