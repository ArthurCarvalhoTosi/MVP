import { render, screen, userEvent } from '@testing-library/react-native';
import History from '@/app/history';
import type { Db } from '@/db/client';
import { registerMaintenance } from '@/db/repo';
import { addDays, formatBRL, formatDate, todayISO } from '@/domain';
import { params, redirect, router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

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
    screen.getByText('Nenhuma troca registrada ainda. Quando você registrar a primeira, ela aparece aqui.'),
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

test("shows the history of the car it was opened for, not the first one's", async () => {
  await registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: todayISO(), km: 42000, costCents: 9900 });
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
