import { render, screen, userEvent } from '@testing-library/react-native';
import Onboarding from '@/app/onboarding';
import type { Db } from '@/db/client';
import { itemsQuery, readingsQuery, selectedVehicleIdQuery, specsQuery, vehiclesQuery } from '@/db/repo';
import { CAR_MODELS, modelSpecs, modelYears, suggestedNickname, todayISO, type CarModel } from '@/domain';
import { router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
});

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name });
const search = () => screen.getByLabelText('Qual é o modelo?');
const result = (m: CarModel) => screen.getByRole('button', { name: `${m.brand} ${m.model} ${m.engine}, ${modelYears(m)}` });
// A timing-chain engine: its manual has no belt to replace.
const chainModel = CAR_MODELS.find((m) => m.presets?.timing_belt === null)!;

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
  expect(vehiclesQuery(db).all()).toEqual([]);
  expect(router.dismissTo).not.toHaveBeenCalled();
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
  expect(vehiclesQuery(db).all()).toEqual([]);
});

test('creates the vehicle with the chosen pace, severe intervals and items, then opens the garage', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup();

  // First car: the layout's "Seu carro" title stays.
  expect(screen.queryByRole('header', { name: 'Adicionar carro' })).not.toBeOnTheScreen();
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

  expect(router.dismissTo).toHaveBeenCalledWith('/');
  const [vehicle] = vehiclesQuery(db).all();
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

test('adds another car and opens it in the garage', async () => {
  await seedVehicle(db);
  await render(<Onboarding />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Adicionar carro' })).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Como você chama o carro?'), 'Meu Gol');
  await user.type(screen.getByLabelText('Hodômetro atual, km'), '80000');
  await user.press(screen.getByRole('button', { name: 'Adicionar carro' }));

  const cars = vehiclesQuery(db).all();
  expect(cars.map((v) => v.nickname)).toEqual(['Meu Sandero', 'Meu Gol']);
  expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: cars[1].id }]);
  expect(router.dismissTo).toHaveBeenCalledWith('/');
});

test('finds the model, suggests a nickname, skips what the engine lacks and fills the cola de bolso', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup();
  expect(search()).toHaveProp('autoCorrect', false);

  await user.type(search(), chainModel.model.toUpperCase());
  await user.press(result(chainModel));

  expect(screen.queryByLabelText('Qual é o modelo?')).not.toBeOnTheScreen();
  expect(screen.getByText(`${chainModel.brand} ${chainModel.model} ${chainModel.engine}`)).toBeOnTheScreen();
  expect(screen.getByLabelText('Como você chama o carro?')).toHaveDisplayValue(suggestedNickname(chainModel));
  expect(screen.queryByRole('checkbox', { name: /^Correia dentada/ })).not.toBeOnTheScreen();

  await user.type(screen.getByLabelText('Hodômetro atual, km'), '30000');
  await user.press(screen.getByRole('button', { name: 'Começar' }));

  expect(router.dismissTo).toHaveBeenCalledWith('/');
  const [vehicle] = vehiclesQuery(db).all();
  expect(vehicle).toEqual(expect.objectContaining({ modelRef: chainModel.id, nickname: suggestedNickname(chainModel) }));
  expect(specsQuery(db, vehicle.id).all()[0]).toEqual(expect.objectContaining(modelSpecs(chainModel)));
  expect(itemsQuery(db, vehicle.id).all().map((i) => i.templateKey)).not.toContain('timing_belt');
});

test('never overwrites a nickname the user typed, only its own suggestion', async () => {
  const other = CAR_MODELS.find((m) => m.model !== chainModel.model)!;
  await render(<Onboarding />);
  const user = userEvent.setup();
  const nickname = () => screen.getByLabelText('Como você chama o carro?');

  await user.type(search(), chainModel.model);
  await user.press(result(chainModel));
  expect(nickname()).toHaveDisplayValue(suggestedNickname(chainModel));

  // Back to the search, which keeps what was typed; another pick replaces our own suggestion.
  await user.press(screen.getByRole('button', { name: 'Trocar modelo' }));
  expect(search()).toHaveDisplayValue(chainModel.model);
  await user.clear(search());
  await user.type(search(), other.model);
  await user.press(result(other));
  expect(nickname()).toHaveDisplayValue(suggestedNickname(other));

  await user.clear(nickname());
  await user.type(nickname(), 'Carro da Ana');
  await user.press(screen.getByRole('button', { name: 'Trocar modelo' }));
  await user.press(result(other));
  expect(nickname()).toHaveDisplayValue('Carro da Ana');
});

test('goes on without a model when the car is not listed, leaving the cola de bolso to fill later', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup();

  await user.type(search(), 'carro inventado');
  expect(screen.getByText(/^Não achamos esse modelo/)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Meu carro não está na lista' }));

  expect(screen.getByText('Não está na lista')).toBeOnTheScreen();
  expect(screen.getByText('Depois você preenche óleo, calibragem, palhetas e bateria.')).toBeOnTheScreen();
  expect(checkbox(/^Correia dentada/)).toBeChecked();

  await user.type(screen.getByLabelText('Como você chama o carro?'), 'Meu Fusca');
  await user.type(screen.getByLabelText('Hodômetro atual, km'), '120000');
  await user.press(screen.getByRole('button', { name: 'Começar' }));

  const [vehicle] = vehiclesQuery(db).all();
  expect(vehicle.modelRef).toBeNull();
  expect(specsQuery(db, vehicle.id).all()[0]).toEqual(expect.objectContaining({ oilSpec: null, tireFrontPsi: null, battery: null }));
  expect(itemsQuery(db, vehicle.id).all()).toHaveLength(5);
});
