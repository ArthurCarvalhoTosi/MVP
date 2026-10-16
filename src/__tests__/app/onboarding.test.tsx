import { render, screen, userEvent } from '@testing-library/react-native';
import Onboarding from '@/app/onboarding';
import type { Db } from '@/db/client';
import { itemsQuery, readingsQuery, vehicleQuery } from '@/db/repo';
import { todayISO } from '@/domain';
import { router, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
});

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name });

test('shows what to fix and creates nothing when the form is incomplete', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup();
  for (const name of [/^Troca de óleo/, /^Filtros/, /^Rodízio/, /^Revisão/, /^Correia/]) {
    await user.press(checkbox(name));
  }
  expect(checkbox(/^Troca de óleo/)).not.toBeChecked();

  await user.press(screen.getByRole('button', { name: 'Começar' }));

  expect(screen.getByText('Digite um nome para o carro.')).toBeOnTheScreen();
  expect(screen.getByText('Digite o KM do painel usando só números.')).toBeOnTheScreen();
  expect(screen.getByText('Marque pelo menos um item para acompanhar.')).toBeOnTheScreen();
  expect(screen.getByText('Confira os campos destacados acima.')).toBeOnTheScreen();
  expect(vehicleQuery(db).all()).toEqual([]);
  expect(router.replace).not.toHaveBeenCalled();
});

test('rejects an odometer too high to be real', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup();
  const km = screen.getByLabelText('Hodômetro atual, km');
  expect(km).toHaveProp('maxLength', 9);
  expect(km).toHaveProp('selectTextOnFocus', true);

  await user.type(screen.getByLabelText('Como você chama o carro?'), 'Meu Sandero');
  await user.type(km, '2.000.001');
  await user.press(screen.getByRole('button', { name: 'Começar' }));

  expect(screen.getByText('Confira o KM: o valor parece alto demais.')).toBeOnTheScreen();
  expect(vehicleQuery(db).all()).toEqual([]);
});

test('creates the vehicle with the chosen pace, severe intervals and items, then opens the garage', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup();

  // Presets start checked, with normal-use intervals.
  expect(checkbox(/^Troca de óleo e filtro\. A cada 10\.000 km ou 12 meses$/)).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Cerca de 1.000 km' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Não' })).toBeChecked();
  expect(screen.getByText('Quanto você roda por mês?')).toBeOnTheScreen();
  expect(screen.getByText('Usa mais na cidade, com trânsito?')).toBeOnTheScreen();

  await user.type(screen.getByLabelText('Como você chama o carro?'), 'Meu Sandero 2018');
  await user.type(screen.getByLabelText('Hodômetro atual, km'), '46.250');
  await user.press(screen.getByRole('radio', { name: '1.500 km ou mais' }));
  await user.press(screen.getByRole('radio', { name: 'Sim' }));
  expect(checkbox(/^Troca de óleo e filtro\. A cada 5\.000 km ou 6 meses$/)).toBeChecked();
  expect(checkbox(/^Correia dentada\. A cada 40\.000 km ou 4 anos$/)).toBeChecked();
  await user.press(checkbox(/^Correia dentada/));

  await user.press(screen.getByRole('button', { name: 'Começar' }));

  expect(router.replace).toHaveBeenCalledWith('/');
  const [vehicle] = vehicleQuery(db).all();
  expect(vehicle).toEqual(
    expect.objectContaining({ nickname: 'Meu Sandero 2018', monthlyKmEstimate: 1600, severeUse: true }),
  );
  expect(readingsQuery(db, vehicle.id).all()).toEqual([{ km: 46250, readAt: todayISO() }]);
  const items = itemsQuery(db, vehicle.id).all();
  expect(items.map((i) => [i.templateKey, i.intervalKm, i.intervalMonths])).toEqual(
    expect.arrayContaining([
      ['oil', 5000, 6],
      ['air_filters', 5000, 6],
      ['tire_rotation', 10000, null],
      ['brakes', 10000, null],
    ]),
  );
  expect(items).toHaveLength(4);
  expect(items.every((i) => i.baselineKm === 46250 && i.baselineDate === todayISO())).toBe(true);
});
