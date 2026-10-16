import { render, screen, userEvent } from '@testing-library/react-native';
import Specs from '@/app/specs';
import type { Db } from '@/db/client';
import * as repo from '@/db/repo';
import { specsQuery, upsertSpecs } from '@/db/repo';
import { params, redirect, router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

let db: Db;
let vehicleId: string;
beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId } = await seedVehicle(db));
  await upsertSpecs(db, vehicleId, { oilSpec: '5W-30 sintético', battery: '60 Ah' });
  params.vehicleId = vehicleId;
});

test('prefills saved values, saves edits and stores emptied fields as null', async () => {
  await render(<Specs />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Cola de bolso' })).toBeOnTheScreen();
  expect(screen.getByText('Valores de referência. Confira no manual do proprietário.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Óleo')).toHaveDisplayValue('5W-30 sintético');

  await user.clear(screen.getByLabelText('Bateria'));
  await user.type(screen.getByLabelText('Pneu dianteiro, psi'), '32');
  await user.type(screen.getByLabelText('Pneu traseiro, psi'), '30');
  await user.type(screen.getByLabelText('Palheta do motorista'), '22"');
  await user.press(screen.getByRole('button', { name: 'Salvar' }));

  expect(router.back).toHaveBeenCalled();
  expect(specsQuery(db, vehicleId).all()[0]).toEqual(
    expect.objectContaining({
      oilSpec: '5W-30 sintético',
      tireFrontPsi: 32,
      tireRearPsi: 30,
      wiperDriver: '22"',
      wiperPassenger: null,
      battery: null,
    }),
  );
});

test('asks for numbers in the tire pressure fields', async () => {
  await render(<Specs />);
  const user = userEvent.setup();

  await user.type(screen.getByLabelText('Pneu dianteiro, psi'), '32,5');
  await user.press(screen.getByRole('button', { name: 'Salvar' }));

  expect(screen.getByText('Digite só números, por exemplo 32.')).toBeOnTheScreen();
  expect(specsQuery(db, vehicleId).all()[0].tireFrontPsi).toBeNull();
  expect(router.back).not.toHaveBeenCalled();
});

test('shows a plain message when saving fails unexpectedly, and lets the user try again', async () => {
  const upsert = jest.spyOn(repo, 'upsertSpecs').mockRejectedValueOnce(new Error('disk I/O error'));
  await render(<Specs />);
  const user = userEvent.setup();

  await user.press(screen.getByRole('button', { name: 'Salvar' }));

  expect(screen.getByText('Não foi possível salvar. Tente de novo.')).toBeOnTheScreen();
  expect(screen.queryByText(/disk I\/O/)).not.toBeOnTheScreen();
  expect(router.back).not.toHaveBeenCalled();

  await user.press(screen.getByRole('button', { name: 'Salvar' }));

  expect(router.back).toHaveBeenCalled();
  expect(screen.queryByText('Não foi possível salvar. Tente de novo.')).not.toBeOnTheScreen();
  upsert.mockRestore();
});

test('edits the car it was opened for, not the first one', async () => {
  const { vehicleId: gol } = await seedVehicle(db, undefined, { nickname: 'Meu Gol' });
  params.vehicleId = gol;
  await render(<Specs />);
  const user = userEvent.setup();

  expect(screen.getByLabelText('Óleo')).toHaveDisplayValue('');
  await user.type(screen.getByLabelText('Óleo'), '0W-20');
  await user.press(screen.getByRole('button', { name: 'Salvar' }));

  expect(specsQuery(db, gol).all()[0].oilSpec).toBe('0W-20');
  expect(specsQuery(db, vehicleId).all()[0].oilSpec).toBe('5W-30 sintético');
});

test('leaves for the garage when the car is gone', async () => {
  params.vehicleId = 'missing';
  await render(<Specs />);
  expect(redirect).toHaveBeenCalledWith('/');
});
