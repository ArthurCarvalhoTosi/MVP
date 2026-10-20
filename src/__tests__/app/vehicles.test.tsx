import { render, screen, userEvent } from '@testing-library/react-native';
import Vehicles from '@/app/vehicles';
import type { Db } from '@/db/client';
import * as repo from '@/db/repo';
import { removeVehicle, selectedVehicleIdQuery, vehiclesQuery } from '@/db/repo';
import { vehicles } from '@/db/schema';
import { addDays, formatKm, projectOdometer, todayISO } from '@/domain';
import { attachmentsMock, router, seedVehicle, setupScreen, spyAlert } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('@/attachments', () => require('@/test-utils/screens').attachmentsMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

let db: Db;
let sandero: string;
let gol: string;
const since = addDays(todayISO(), -400);
// 400 days at ~1.000 km/month: oil is overdue.
const SANDERO = `Meu Sandero. Crítico. 1 troca vencida ou próxima. ${formatKm(
  projectOdometer([{ km: 40000, readAt: since }], 1000, todayISO()),
)}`;
const GOL = 'Meu Gol. Em dia. Tudo em dia. 80.000 km';

beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId: sandero } = await seedVehicle(db, since));
  // Created last, so selected.
  ({ vehicleId: gol } = await seedVehicle(db, todayISO(), {
    nickname: 'Meu Gol',
    odometerKm: 80000,
  }));
});

const MESSAGE = 'O histórico deste carro será apagado deste aparelho. Isso não pode ser desfeito.';

test('lists every car with its status and km, the open one selected', async () => {
  await render(<Vehicles />);

  expect(screen.getByRole('header', { name: 'Seus carros' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: SANDERO })).not.toBeSelected();
  expect(screen.getByRole('button', { name: GOL })).toBeSelected();
  expect(screen.getByRole('button', { name: 'Remover Meu Sandero' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Remover Meu Gol' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Renomear Meu Sandero' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Renomear Meu Gol' })).toBeOnTheScreen();
});

test('opens the rename sheet for the tapped car', async () => {
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Renomear Meu Sandero' }));

  // Replace, not push: on iOS a pushed screen would open underneath this sheet.
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/rename-vehicle',
    params: { vehicleId: sandero },
  });
});

test('opens the tapped car and closes', async () => {
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: SANDERO }));

  expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: sandero }]);
  expect(router.back).toHaveBeenCalled();
});

test('removes a car only after confirming', async () => {
  const { alert, press } = spyAlert();
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Remover Meu Gol' }));
  expect(alert).toHaveBeenCalledWith('Remover Meu Gol?', MESSAGE, [
    expect.objectContaining({ text: 'Cancelar', style: 'cancel' }),
    expect.objectContaining({ text: 'Remover', style: 'destructive' }),
  ]);
  expect(vehiclesQuery(db).all()).toHaveLength(2);
  await press('Remover');

  // Soft delete: the row stays, marked deleted.
  expect(
    vehiclesQuery(db)
      .all()
      .map((v) => v.id),
  ).toEqual([sandero]);
  expect(
    db
      .select()
      .from(vehicles)
      .all()
      .find((v) => v.id === gol)?.deletedAt,
  ).toEqual(expect.any(String));
  // Its receipt photos leave the disk right away.
  expect(attachmentsMock.deleteRemovedPhotos).toHaveBeenCalledWith(db);
  // Other cars remain, so the sheet stays open; the remaining car becomes the open one.
  expect(router.back).not.toHaveBeenCalled();
  await screen.rerender(<Vehicles />);
  expect(screen.queryByRole('button', { name: GOL })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: SANDERO })).toBeSelected();
});

test('keeps the car when the removal is cancelled', async () => {
  const { press } = spyAlert();
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Remover Meu Sandero' }));
  await press('Cancelar');

  expect(vehiclesQuery(db).all()).toHaveLength(2);
  expect(router.back).not.toHaveBeenCalled();
});

test('closes after removing the last car, so the garage can send to onboarding', async () => {
  await removeVehicle(db, sandero);
  const { press } = spyAlert();
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Remover Meu Gol' }));
  await press('Remover');

  expect(vehiclesQuery(db).all()).toEqual([]);
  expect(router.back).toHaveBeenCalled();
});

test('adds a car through onboarding', async () => {
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Adicionar carro' }));

  expect(router.replace).toHaveBeenCalledWith('/onboarding');
});

test('opens the backup, restore and account sheets', async () => {
  await render(<Vehicles />);
  const user = userEvent.setup();

  await user.press(screen.getByRole('button', { name: 'Fazer backup' }));
  expect(router.replace).toHaveBeenLastCalledWith('/backup');
  await user.press(screen.getByRole('button', { name: 'Restaurar backup' }));
  expect(router.replace).toHaveBeenLastCalledWith('/restore');
  await user.press(screen.getByRole('button', { name: 'Conta' }));
  expect(router.replace).toHaveBeenLastCalledWith('/account');
});

test('shows a plain message when switching fails', async () => {
  const select = jest
    .spyOn(repo, 'selectVehicle')
    .mockRejectedValueOnce(new Error('disk I/O error'));
  await render(<Vehicles />);

  await userEvent.setup().press(screen.getByRole('button', { name: SANDERO }));

  expect(screen.getByText('Não foi possível salvar. Tente de novo.')).toBeOnTheScreen();
  expect(router.back).not.toHaveBeenCalled();
  select.mockRestore();
});
