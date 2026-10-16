import { render, screen, userEvent } from '@testing-library/react-native';
import AdjustKm from '@/app/adjust-km';
import type { Db } from '@/db/client';
import { readingsQuery } from '@/db/repo';
import { odometerReadings } from '@/db/schema';
import { addDays, todayISO } from '@/domain';
import { router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

let db: Db;
let vehicleId: string;
beforeEach(async () => {
  db = await setupScreen();
  // 30 days at ~1.000 km/month: projected 41.000 km today.
  ({ vehicleId } = await seedVehicle(db, addDays(todayISO(), -30)));
});

const field = () => screen.getByLabelText('KM no painel agora, km');

test('prefills the projection and saves the panel reading as an adjustment', async () => {
  await render(<AdjustKm />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Ajustar KM' })).toBeOnTheScreen();
  expect(field()).toHaveDisplayValue('41000');

  await user.clear(field());
  await user.type(field(), '40.800');
  await user.press(screen.getByRole('button', { name: 'Salvar KM' }));

  expect(router.back).toHaveBeenCalled();
  expect(readingsQuery(db, vehicleId).all()).toContainEqual({ km: 40800, readAt: todayISO() });
  expect(db.select({ source: odometerReadings.source }).from(odometerReadings).all()).toContainEqual({ source: 'adjust' });
});

test('rejects a KM below the last reading', async () => {
  await render(<AdjustKm />);
  const user = userEvent.setup();

  await user.clear(field());
  await user.type(field(), '39999');
  await user.press(screen.getByRole('button', { name: 'Salvar KM' }));

  expect(screen.getByText('Esse KM é menor que uma leitura anterior. Confira o valor.')).toBeOnTheScreen();
  expect(readingsQuery(db, vehicleId).all()).toHaveLength(1);
  expect(router.back).not.toHaveBeenCalled();
});
