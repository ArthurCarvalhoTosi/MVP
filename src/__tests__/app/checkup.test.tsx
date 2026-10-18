import { render, screen, userEvent, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import Checkup from '@/app/checkup';
import type { Db } from '@/db/client';
import * as repo from '@/db/repo';
import { setSnooze } from '@/db/repo';
import { maintenanceItems } from '@/db/schema';
import { addDays, formatDate, todayISO } from '@/domain';
import { params, router, seedVehicle, setupScreen, spyAlert } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
});

const OIL_ROW = /^Troca de óleo e filtro\. Crítico\. Vencido/;
const EMPTY = 'Nenhum lembrete para esta semana.';
const inSection = (car: string) => {
  // A car's rows follow its header; the header's parent holds both.
  const header = screen.getByRole('header', { name: car });
  return within(header.parent!);
};

test('lists what needs attention in every car, under each car, and nothing that is in day', async () => {
  // 400 days at ~1.000 km/month: oil overdue on the Sandero; the new Gol is all in day.
  const { oilId } = await seedVehicle(db, addDays(todayISO(), -400));
  await seedVehicle(db, addDays(todayISO(), -330), { nickname: 'Meu Fox', odometerKm: 20000 });
  await seedVehicle(db, todayISO(), { nickname: 'Meu Gol', odometerKm: 80000 });
  await render(<Checkup />);

  expect(inSection('Meu Sandero').getByRole('button', { name: OIL_ROW })).toBeOnTheScreen();
  // 330 days: ~11.000 km, past the 10.000 km limit too.
  expect(inSection('Meu Fox').getByRole('button', { name: OIL_ROW })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Meu Gol' })).not.toBeOnTheScreen();
  expect(screen.queryByText(EMPTY)).not.toBeOnTheScreen();

  await userEvent.setup().press(inSection('Meu Sandero').getByRole('button', { name: 'Registrar troca' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/register', params: { itemId: oilId } });
});

test('snoozes an item for 15 days: it leaves the list and the date is confirmed', async () => {
  const { oilId } = await seedVehicle(db, addDays(todayISO(), -400));
  await render(<Checkup />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Adiar 15 dias' }));

  const until = addDays(todayISO(), 15);
  expect(db.select().from(maintenanceItems).where(eq(maintenanceItems.id, oilId)).get()?.snoozedUntil).toBe(until);
  await screen.rerender(<Checkup />);
  expect(screen.queryByRole('button', { name: OIL_ROW })).not.toBeOnTheScreen();
  expect(screen.getByText(`Troca de óleo e filtro: lembrete adiado até ${formatDate(until)}.`)).toBeOnTheScreen();
  expect(screen.getByText(EMPTY)).toBeOnTheScreen();
});

test('confirms a snooze made from the notification', async () => {
  const { oilId } = await seedVehicle(db, addDays(todayISO(), -400));
  const until = addDays(todayISO(), 15);
  await setSnooze(db, oilId, until);
  params.snoozed = oilId;
  await render(<Checkup />);

  expect(screen.getByText(`Troca de óleo e filtro: lembrete adiado até ${formatDate(until)}.`)).toBeOnTheScreen();
});

test('ignores a snoozed id that no longer exists', async () => {
  params.snoozed = 'gone';
  await render(<Checkup />);

  expect(screen.queryByText(/lembrete adiado/)).not.toBeOnTheScreen();
});

test('explains the reminder when nothing is pending', async () => {
  await seedVehicle(db);
  await render(<Checkup />);

  expect(screen.getByText(EMPTY)).toBeOnTheScreen();
  expect(
    screen.getByText('Quando uma troca estiver perto de vencer, ela aparece aqui e no lembrete de sábado, às 9h.'),
  ).toBeOnTheScreen();
});

test('shows a plain message when snoozing fails', async () => {
  await seedVehicle(db, addDays(todayISO(), -400));
  const spy = jest.spyOn(repo, 'setSnooze').mockRejectedValueOnce(new Error('disk I/O error'));
  await render(<Checkup />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Adiar 15 dias' }));

  expect(screen.getByText('Não foi possível salvar. Tente de novo.')).toBeOnTheScreen();
  spy.mockRestore();
});

test('offers a test reminder in development builds', async () => {
  const { alert } = spyAlert();
  await render(<Checkup />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Testar lembrete (desenvolvimento)' }));

  // Nothing was planned in this test run, so there is nothing to send.
  expect(alert).toHaveBeenCalledWith('Lembrete de teste', 'Nada pendente para testar.');
});
