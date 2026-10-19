import { act, render, screen, userEvent } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import Dashboard from '@/app/index';
import type { Db } from '@/db/client';
import { createVehicle, selectVehicle, upsertSpecs } from '@/db/repo';
import { devicePrefs } from '@/db/schema';
import { addDays, CAR_MODELS, todayISO } from '@/domain';
import { redirect, router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
});

test('redirects to onboarding when there is no vehicle', async () => {
  await render(<Dashboard />);
  expect(redirect).toHaveBeenCalledWith('/onboarding');
});

test('shows an overdue item with "Registrar troca" and a stale-KM hint', async () => {
  // 400 days at ~1.000 km/month: oil (10.000 km / 12 months) passed its km limit first, ~3.333 km ago.
  const { oilId } = await seedVehicle(db, addDays(todayISO(), -400));
  await render(<Dashboard />);

  expect(screen.getByRole('header', { name: 'Precisa de atenção' })).toBeOnTheScreen();
  // The km past the limit, not a day count estimated from the km/day.
  expect(
    screen.getByRole('button', { name: /^Troca de óleo e filtro\. Crítico\. Passou 3\.33\d km$/ }),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Faz mais de 30 dias que o KM não é atualizado/)).toBeOnTheScreen();
  expect(screen.queryByText('Tudo em dia.')).not.toBeOnTheScreen();

  await userEvent.setup().press(screen.getByRole('button', { name: 'Registrar troca' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/register', params: { itemId: oilId } });
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Editar Troca de óleo e filtro' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/item', params: { itemId: oilId } });
});

test('shows the all-clear state with the next item, and expands ok items', async () => {
  const { vehicleId } = await seedVehicle(db);
  await upsertSpecs(db, vehicleId, { tireFrontPsi: 32, tireRearPsi: 30 });
  await render(<Dashboard />);
  const user = userEvent.setup();

  expect(screen.getByLabelText('Hodômetro estimado: 40.000 quilômetros')).toBeOnTheScreen();
  expect(screen.getByText('Tudo em dia.')).toBeOnTheScreen();
  // 10.000 km at ~33 km/day = 300 days, before the 12-month limit.
  expect(screen.getByText('Próxima: Troca de óleo e filtro, vence em ~10 meses')).toBeOnTheScreen();
  expect(screen.queryByText(/Faz mais de 30 dias/)).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Calibragem: 32 / 30 psi')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Óleo: Adicionar' })).toBeOnTheScreen();

  expect(
    screen.queryByRole('button', { name: /^Troca de óleo e filtro\. Em dia/ }),
  ).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Em dia (1)' })).toBeCollapsed();
  await user.press(screen.getByRole('button', { name: 'Em dia (1)' }));
  expect(screen.getByRole('button', { name: 'Em dia (1)' })).toBeExpanded();
  await user.press(screen.getByRole('button', { name: /^Troca de óleo e filtro\. Em dia/ }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/register',
    params: { itemId: expect.any(String) },
  });

  await user.press(screen.getByRole('button', { name: 'Ver histórico' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/history', params: { vehicleId } });
});

test('shows the selected car, whose sheets get its id, and offers the car list in the header', async () => {
  const { vehicleId: sandero } = await seedVehicle(db);
  // Created last, so selected.
  const { vehicleId: gol } = await seedVehicle(db, todayISO(), {
    nickname: 'Meu Gol',
    odometerKm: 80000,
  });
  await render(<Dashboard />);
  const user = userEvent.setup();

  expect(screen.getByLabelText('Hodômetro estimado: 80.000 quilômetros')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Ajustar KM' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/adjust-km', params: { vehicleId: gol } });
  await user.press(screen.getByRole('button', { name: 'Óleo: Adicionar' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/specs', params: { vehicleId: gol } });
  await user.press(screen.getByRole('button', { name: 'Adicionar manutenção' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/item', params: { vehicleId: gol } });

  await user.press(screen.getByRole('button', { name: 'Trocar de carro. Atual: Meu Gol' }));
  expect(router.push).toHaveBeenCalledWith('/vehicles');

  await selectVehicle(db, sandero);
  await screen.rerender(<Dashboard />);
  expect(
    screen.getByRole('button', { name: 'Trocar de carro. Atual: Meu Sandero' }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Hodômetro estimado: 40.000 quilômetros')).toBeOnTheScreen();
});

test('says the seed values are references only for a car picked from the list', async () => {
  const note = 'Valores de referência. Confira no manual do proprietário.';
  await seedVehicle(db);
  await render(<Dashboard />);
  expect(screen.queryByText(note)).not.toBeOnTheScreen();

  const model = CAR_MODELS.find((m) => m.oil)!;
  await createVehicle(
    db,
    {
      nickname: 'Meu carro',
      odometerKm: 1000,
      monthlyKmEstimate: 1000,
      severeUse: false,
      modelRef: model.id,
      items: [],
    },
    todayISO(),
  );
  await screen.rerender(<Dashboard />);
  expect(screen.getByLabelText(`Óleo: ${model.oil}`)).toBeOnTheScreen();
  expect(screen.getByText(note)).toBeOnTheScreen();
});

test('opens the oldest car when no car was chosen yet', async () => {
  await seedVehicle(db);
  await seedVehicle(db, todayISO(), { nickname: 'Meu Gol', odometerKm: 80000 });
  // Like an install from before multiple cars: no saved choice.
  db.delete(devicePrefs).run();
  await render(<Dashboard />);

  expect(
    screen.getByRole('button', { name: 'Trocar de carro. Atual: Meu Sandero' }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Hodômetro estimado: 40.000 quilômetros')).toBeOnTheScreen();
});

test('moves to the new day when the app comes back to the foreground', async () => {
  await seedVehicle(db);
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  await render(<Dashboard />);
  const changeState = (state: AppStateStatus) => act(() => listeners.forEach((l) => l(state)));
  expect(screen.getByLabelText('Hodômetro estimado: 40.000 quilômetros')).toBeOnTheScreen();

  // A month later (~1.000 km at the estimate), the app is reopened from the background.
  jest.useFakeTimers({ now: Date.now() + 30 * 86_400_000, advanceTimers: true });
  try {
    await changeState('background');
    expect(screen.getByLabelText('Hodômetro estimado: 40.000 quilômetros')).toBeOnTheScreen();

    await changeState('active');
    expect(screen.getByLabelText('Hodômetro estimado: 41.000 quilômetros')).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
    spy.mockRestore();
  }
});
