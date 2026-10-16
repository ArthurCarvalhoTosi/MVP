import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import Register from '@/app/register';
import type { Db } from '@/db/client';
import { logsQuery } from '@/db/repo';
import { maintenanceItems } from '@/db/schema';
import { addDays, projectOdometer, todayISO } from '@/domain';
import { params, redirect, router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

let db: Db;
let vehicleId: string;
let oilId: string;
const since = addDays(todayISO(), -400);

beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId, oilId } = await seedVehicle(db, since));
  params.itemId = oilId;
});

const kmField = () => screen.getByLabelText('KM no momento da troca, km');

test('saves the log, moves the item baseline to it and closes', async () => {
  const projected = projectOdometer([{ km: 40000, readAt: since }], 1000, todayISO());
  await render(<Register />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Troca de óleo e filtro' })).toBeOnTheScreen();
  expect(kmField()).toHaveDisplayValue(String(projected));
  expect(screen.getByText('Valor estimado. Confira no painel do carro.')).toBeOnTheScreen();
  expect(screen.getByText('Data da troca')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Hoje' })).toBeChecked();

  await user.type(screen.getByLabelText('Custo (opcional), R$'), '1.234,5');
  await user.type(screen.getByLabelText('Marca ou especificação (opcional)'), 'Mobil 5W-30');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(router.back).toHaveBeenCalled();
  expect(logsQuery(db, vehicleId).all()).toEqual([
    expect.objectContaining({
      itemId: oilId,
      itemName: 'Troca de óleo e filtro',
      performedAt: todayISO(),
      km: projected,
      costCents: 123450,
      brandSpec: 'Mobil 5W-30',
    }),
  ]);
  const item = db.select().from(maintenanceItems).where(eq(maintenanceItems.id, oilId)).get();
  expect(item).toEqual(expect.objectContaining({ baselineKm: projected, baselineDate: todayISO() }));
});

test('rejects a KM below an earlier reading', async () => {
  await render(<Register />);
  const user = userEvent.setup();

  await user.clear(kmField());
  await user.type(kmField(), '39000');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  // Correcting an earlier reading lives in Ajustar KM, behind a confirmation.
  expect(
    screen.getByText(
      'Esse KM é menor que uma leitura anterior. Confira o valor. Se o KM salvo antes estava errado, corrija em Ajustar KM.',
    ),
  ).toBeOnTheScreen();
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
  expect(router.back).not.toHaveBeenCalled();
});

test('rejects a KM too high to be real', async () => {
  await render(<Register />);
  const user = userEvent.setup();

  await user.clear(kmField());
  await user.type(kmField(), '2.000.001');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(screen.getByText('Confira o KM: o valor parece alto demais.')).toBeOnTheScreen();
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
});

test('saves once when the button is tapped twice in a row', async () => {
  await render(<Register />);
  const button = screen.getByRole('button', { name: 'Registrar troca' });

  // Raw presses, without userEvent's press-and-release delays; the sheet stays open (router is mocked).
  await fireEvent.press(button);
  await fireEvent.press(button);

  expect(logsQuery(db, vehicleId).all()).toHaveLength(1);
  expect(button).toBeBusy();
});

test('asks for a valid past date and a readable cost', async () => {
  await render(<Register />);
  const user = userEvent.setup();

  await user.press(screen.getByRole('radio', { name: 'Outra data' }));
  await user.type(screen.getByLabelText('Data (DD/MM/AAAA)'), '31/02/2026');
  await user.type(screen.getByLabelText('Custo (opcional), R$'), 'abc');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(screen.getByText('Use uma data até hoje, no formato DD/MM/AAAA.')).toBeOnTheScreen();
  expect(screen.getByText('Digite o valor em reais, por exemplo 150,00.')).toBeOnTheScreen();
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
});

test('leaves for the garage when the item does not exist', async () => {
  params.itemId = 'missing';
  await render(<Register />);
  expect(redirect).toHaveBeenCalledWith('/');
});

test("logs on the item's own car, not the first one", async () => {
  const gol = await seedVehicle(db, todayISO(), { nickname: 'Meu Gol', odometerKm: 80000 });
  params.itemId = gol.oilId;
  await render(<Register />);

  expect(kmField()).toHaveDisplayValue('80000');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(logsQuery(db, gol.vehicleId).all()).toEqual([expect.objectContaining({ itemId: gol.oilId, km: 80000 })]);
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
});
