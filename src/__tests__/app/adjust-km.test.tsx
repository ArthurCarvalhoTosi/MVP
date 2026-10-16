import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import AdjustKm from '@/app/adjust-km';
import type { Db } from '@/db/client';
import { addOdometerReading, readingsQuery } from '@/db/repo';
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
const HINT = 'Valor estimado. Confira no painel do carro.';

async function saveKm(km: string) {
  const user = userEvent.setup();
  await user.clear(field());
  await user.type(field(), km);
  await user.press(screen.getByRole('button', { name: 'Salvar KM' }));
}

/** Spies on Alert.alert and returns a way to press one of its buttons. */
function spyAlert() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const press = async (text: string) => {
    const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
    await act(async () => buttons.find((b) => b.text === text)?.onPress?.());
  };
  return { alert, press };
}

test('prefills the projection and saves the panel reading as an adjustment', async () => {
  await render(<AdjustKm />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Ajustar KM' })).toBeOnTheScreen();
  expect(field()).toHaveDisplayValue('41000');
  expect(field()).toHaveProp('selectTextOnFocus', true);
  expect(field()).toHaveProp('maxLength', 9);
  expect(screen.getByText(HINT)).toBeOnTheScreen();

  await user.clear(field());
  await user.type(field(), '40.800');
  // The value is no longer the estimate.
  expect(screen.queryByText(HINT)).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Salvar KM' }));

  expect(router.back).toHaveBeenCalled();
  expect(readingsQuery(db, vehicleId).all()).toContainEqual({ km: 40800, readAt: todayISO() });
  expect(db.select({ source: odometerReadings.source }).from(odometerReadings).all()).toContainEqual({ source: 'adjust' });
});

test('asks before correcting a KM below earlier readings, then discards the higher ones', async () => {
  // An earlier log accepted a too-high projection.
  await addOdometerReading(db, vehicleId, 41500, addDays(todayISO(), -5), 'log');
  const { alert, press } = spyAlert();
  await render(<AdjustKm />);

  await saveKm('41.200');

  expect(alert).toHaveBeenCalledWith(
    'Corrigir o KM?',
    'Esse valor é menor que um KM registrado antes. Se o painel mostra este número, as leituras maiores serão descartadas e as próximas trocas recalculadas.',
    [expect.objectContaining({ text: 'Cancelar', style: 'cancel' }), expect.objectContaining({ text: 'Corrigir KM' })],
  );
  expect(router.back).not.toHaveBeenCalled();

  await press('Corrigir KM');

  expect(router.back).toHaveBeenCalled();
  expect(readingsQuery(db, vehicleId).all().map((r) => r.km)).toEqual([40000, 41200]);
});

test('keeps every reading when the correction is cancelled', async () => {
  const { alert, press } = spyAlert();
  await render(<AdjustKm />);

  await saveKm('39999');
  expect(alert).toHaveBeenCalledTimes(1);
  await press('Cancelar');

  expect(readingsQuery(db, vehicleId).all()).toHaveLength(1);
  expect(router.back).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Salvar KM' })).toBeEnabled();
});

test('rejects a KM too high to be real', async () => {
  await render(<AdjustKm />);

  await saveKm('2000001');

  expect(screen.getByText('Confira o KM: o valor parece alto demais.')).toBeOnTheScreen();
  expect(readingsQuery(db, vehicleId).all()).toHaveLength(1);
});
