import { render, screen, userEvent } from '@testing-library/react-native';
import History from '@/app/history';
import type { Db } from '@/db/client';
import { registerMaintenance } from '@/db/repo';
import { addDays, formatBRL, formatDate, todayISO } from '@/domain';
import { router, seedVehicle, setupScreen } from '@/test-utils/screens';

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
