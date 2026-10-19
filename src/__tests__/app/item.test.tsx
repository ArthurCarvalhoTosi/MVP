import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import Item from '@/app/item';
import type { Db } from '@/db/client';
import { itemsQuery, logsQuery, registerMaintenance } from '@/db/repo';
import { addDays, todayISO } from '@/domain';
import {
  OIL,
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
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

let db: Db;
let vehicleId: string;
let oilId: string;

beforeEach(async () => {
  db = await setupScreen();
  // 30 days ago at ~1.000 km/month: projected 41.000 km today.
  ({ vehicleId, oilId } = await seedVehicle(db, addDays(todayISO(), -30)));
  params.vehicleId = vehicleId;
});

const name = () => screen.getByLabelText('O que você quer acompanhar?');
const km = () => screen.getByLabelText('A cada quantos km?, km');
const months = () => screen.getByLabelText('Ou a cada quantos meses?, meses');
const add = () => screen.getByRole('button', { name: 'Adicionar' });
const custom = () =>
  itemsQuery(db, vehicleId)
    .all()
    .filter((i) => i.name !== OIL.name);

test('adds a custom item starting today at the projected km, and closes', async () => {
  await render(<Item />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Nova manutenção' })).toBeOnTheScreen();
  await user.type(name(), 'Fluido de freio');
  await user.type(km(), '20.000');
  await user.type(months(), '24');
  await user.press(add());

  expect(custom()).toEqual([
    expect.objectContaining({
      templateKey: null,
      name: 'Fluido de freio',
      intervalKm: 20000,
      intervalMonths: 24,
      baselineKm: 41000,
      baselineDate: todayISO(),
    }),
  ]);
  expect(router.back).toHaveBeenCalled();
});

test('accepts only months', async () => {
  await render(<Item />);
  const user = userEvent.setup();

  await user.type(name(), 'Palhetas');
  await user.type(months(), '12');
  await user.press(add());

  expect(custom()).toEqual([
    expect.objectContaining({ name: 'Palhetas', intervalKm: null, intervalMonths: 12 }),
  ]);
});

test('asks for a name and at least one interval', async () => {
  await render(<Item />);
  const user = userEvent.setup();

  await user.press(add());

  expect(screen.getByText('Digite o nome da manutenção.')).toBeOnTheScreen();
  expect(screen.getByText('Preencha os km, os meses ou os dois.')).toBeOnTheScreen();
  expect(custom()).toEqual([]);
  expect(router.back).not.toHaveBeenCalled();
});

test('rejects zero, non-numbers and intervals too long', async () => {
  await render(<Item />);
  const user = userEvent.setup();

  await user.type(name(), 'Fluido');
  await user.type(km(), '0');
  await user.type(months(), '999');
  await user.press(add());

  expect(screen.getByText('Use só números maiores que zero.')).toBeOnTheScreen();
  expect(screen.getByText('Confira o valor: parece alto demais.')).toBeOnTheScreen();
  expect(custom()).toEqual([]);
});

test('saves once when the button is tapped twice in a row', async () => {
  await render(<Item />);
  const user = userEvent.setup();
  await user.type(name(), 'Fluido');
  await user.type(months(), '24');

  await fireEvent.press(add());
  await fireEvent.press(add());

  expect(custom()).toHaveLength(1);
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(add()).toBeBusy();
});

test('leaves for the garage when the car is gone', async () => {
  params.vehicleId = 'missing';
  await render(<Item />);
  expect(redirect).toHaveBeenCalledWith('/');
});

describe('editing an item', () => {
  beforeEach(() => {
    delete params.vehicleId;
    params.itemId = oilId;
  });

  test('starts from the saved values, saves the changes and keeps the baseline', async () => {
    await render(<Item />);
    const user = userEvent.setup();

    expect(screen.getByRole('header', { name: 'Editar manutenção' })).toBeOnTheScreen();
    expect(name()).toHaveDisplayValue(OIL.name);
    expect(km()).toHaveDisplayValue('10000');
    expect(months()).toHaveDisplayValue('12');
    await user.clear(name());
    await user.type(name(), 'Óleo 5W-30');
    await user.clear(km());
    await user.press(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(itemsQuery(db, vehicleId).all()).toEqual([
      expect.objectContaining({
        id: oilId,
        templateKey: 'oil',
        name: 'Óleo 5W-30',
        intervalKm: null,
        intervalMonths: 12,
        baselineKm: 40000,
      }),
    ]);
    expect(router.back).toHaveBeenCalled();
  });

  test('removes the item after confirming, keeping its logs in history', async () => {
    await registerMaintenance(db, {
      vehicleId,
      itemId: oilId,
      performedAt: todayISO(),
      km: 41000,
    });
    const { alert, press } = spyAlert();
    await render(<Item />);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Remover manutenção' }));
    expect(alert).toHaveBeenCalledWith(
      `Remover ${OIL.name}?`,
      'O item sai do painel e dos lembretes. As trocas já registradas continuam no histórico.',
      expect.anything(),
    );
    await press('Cancelar');
    expect(itemsQuery(db, vehicleId).all()).toHaveLength(1);

    await user.press(screen.getByRole('button', { name: 'Remover manutenção' }));
    await press('Remover');

    expect(itemsQuery(db, vehicleId).all()).toEqual([]);
    expect(logsQuery(db, vehicleId).all()).toEqual([
      expect.objectContaining({ itemId: oilId, itemName: OIL.name }),
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test('leaves for the garage when the item is gone', async () => {
    params.itemId = 'missing';
    await render(<Item />);
    expect(redirect).toHaveBeenCalledWith('/');
  });
});
