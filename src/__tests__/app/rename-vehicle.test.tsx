import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import RenameVehicle from '@/app/rename-vehicle';
import type { Db } from '@/db/client';
import { vehiclesQuery } from '@/db/repo';
import { params, redirect, router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

let db: Db;
let vehicleId: string;

beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId } = await seedVehicle(db));
  params.vehicleId = vehicleId;
});

const field = () => screen.getByLabelText('Como você chama o carro?');

test('starts from the current name, saves the new one and closes', async () => {
  await render(<RenameVehicle />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Renomear carro' })).toBeOnTheScreen();
  expect(field()).toHaveDisplayValue('Meu Sandero');
  await user.clear(field());
  await user.type(field(), ' Sandero da Ana ');
  await user.press(screen.getByRole('button', { name: 'Salvar nome' }));

  expect(vehiclesQuery(db).all()).toEqual([
    expect.objectContaining({ nickname: 'Sandero da Ana' }),
  ]);
  expect(router.back).toHaveBeenCalled();
});

test('asks for a name', async () => {
  await render(<RenameVehicle />);
  const user = userEvent.setup();

  await user.clear(field());
  await user.type(field(), '   ');
  await user.press(screen.getByRole('button', { name: 'Salvar nome' }));

  expect(screen.getByText('Digite um nome para o carro.')).toBeOnTheScreen();
  expect(vehiclesQuery(db).all()).toEqual([expect.objectContaining({ nickname: 'Meu Sandero' })]);
  expect(router.back).not.toHaveBeenCalled();
});

test('saves once when the button is tapped twice in a row', async () => {
  await render(<RenameVehicle />);
  const button = screen.getByRole('button', { name: 'Salvar nome' });

  await fireEvent.press(button);
  await fireEvent.press(button);

  expect(router.back).toHaveBeenCalledTimes(1);
  expect(button).toBeBusy();
});

test('leaves for the garage when the car is gone', async () => {
  params.vehicleId = 'missing';
  await render(<RenameVehicle />);
  expect(redirect).toHaveBeenCalledWith('/');
});
