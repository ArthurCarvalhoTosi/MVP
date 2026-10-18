import {
  CAR_MODELS,
  findModel,
  modelSpecs,
  modelYears,
  presetsFor,
  searchModels,
  SEED_VERSION,
  suggestedNickname,
  type CarModel,
} from '../models';
import { PRESETS } from '../presets';

const base: CarModel = {
  id: 'marca-carro-1.0-2020',
  brand: 'Marca',
  model: 'Carro',
  engine: '1.0',
  yearFrom: 2020,
  yearTo: null,
  oil: '5W-30 sintético',
  tireFrontPsi: 32,
  tireRearPsi: 30,
  wiperDriver: 22,
  wiperPassenger: 16,
  batteryAh: 60,
  sources: {},
};

const ids = (models: CarModel[]) => models.map((m) => m.id);

describe('seed file', () => {
  const inRange = (n: number | null, min: number, max: number) =>
    n === null || (Number.isInteger(n) && n >= min && n <= max);

  it('has a version and the best sellers', () => {
    expect(Number.isInteger(SEED_VERSION) && SEED_VERSION >= 1).toBe(true);
    expect(new Set(CAR_MODELS.map((m) => `${m.brand} ${m.model}`)).size).toBeGreaterThanOrEqual(45);
  });

  it('has unique, slug-shaped ids', () => {
    const all = ids([...CAR_MODELS]);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  });

  it.each(CAR_MODELS.map((m) => [m.id, m]))('%s has plausible values', (_, m) => {
    expect(m.brand.trim() && m.model.trim() && m.engine.trim()).toBeTruthy();
    expect(m.yearFrom).toBeGreaterThanOrEqual(2000);
    expect(m.yearFrom).toBeLessThanOrEqual(2027);
    expect(m.yearTo === null || m.yearTo >= m.yearFrom).toBe(true);
    expect(m.feminine === undefined || typeof m.feminine === 'boolean').toBe(true);
    // Viscosity first, as on the bottle ("5W-30 sintético"), short enough for a plaque. VW's
    // manuals name only the norm, so those read "Sintético, VW 508 88".
    if (m.oil !== null) {
      expect(m.oil).toMatch(/^(\d{1,2}W-\d{2}\b|Sintético, VW \d{3} \d{2}$)/);
      expect(m.oil.length).toBeLessThanOrEqual(40);
    }
    expect(inRange(m.tireFrontPsi, 26, 60)).toBe(true);
    expect(inRange(m.tireRearPsi, 26, 60)).toBe(true);
    expect(inRange(m.wiperDriver, 12, 30)).toBe(true);
    expect(inRange(m.wiperPassenger, 12, 30)).toBe(true);
    expect(inRange(m.batteryAh, 30, 120)).toBe(true);
  });

  it.each(CAR_MODELS.map((m) => [m.id, m]))('%s only overrides known presets with real intervals', (_, m) => {
    const keys = PRESETS.map((p) => p.key);
    for (const [key, schedule] of Object.entries(m.presets ?? {})) {
      expect(keys).toContain(key);
      if (!schedule) continue;
      for (const s of [schedule.normal, schedule.severe]) {
        expect(s.km !== null || s.months !== null).toBe(true);
        expect(inRange(s.km, 1000, 300000) && inRange(s.months, 1, 240)).toBe(true);
      }
    }
  });

  it.each(CAR_MODELS.map((m) => [m.id, m]))('%s cites a source for every value it has', (_, m) => {
    const needs = {
      oil: m.oil !== null,
      tires: m.tireFrontPsi !== null || m.tireRearPsi !== null,
      wipers: m.wiperDriver !== null || m.wiperPassenger !== null,
      battery: m.batteryAh !== null,
      presets: m.presets !== undefined,
    };
    for (const [field, needed] of Object.entries(needs)) {
      if (!needed) continue;
      expect([field, m.sources[field]?.length ?? 0]).not.toEqual([field, 0]);
      for (const url of m.sources[field]!) expect(url).toMatch(/^https:\/\/\S+$/);
    }
  });
});

describe('searchModels', () => {
  it('finds nothing for a blank query', () => {
    expect(searchModels('')).toEqual([]);
    expect(searchModels('   ')).toEqual([]);
  });

  it('ignores case, accents and punctuation', () => {
    const tcross = ids(searchModels('t-cross'));
    expect(tcross.length).toBeGreaterThan(0);
    expect(searchModels('t-cross').every((m) => m.model === 'T-Cross')).toBe(true);
    expect(ids(searchModels('TCROSS'))).toEqual(tcross);
    expect(ids(searchModels('t cross'))).toEqual(expect.arrayContaining(tcross));
    expect(ids(searchModels('citroen'))).toEqual(ids(searchModels('Citroën')));
    expect(searchModels('citroen').length).toBeGreaterThan(0);
  });

  it('matches every word, in any order, across brand, model and engine', () => {
    const onix = searchModels('onix');
    expect(onix.length).toBeGreaterThan(0);
    expect(onix.every((m) => m.model.startsWith('Onix'))).toBe(true);
    const turbo = searchModels('turbo onix');
    expect(turbo.length).toBeGreaterThan(0);
    expect(turbo.every((m) => m.model.startsWith('Onix') && m.engine.includes('turbo'))).toBe(true);
    expect(searchModels('chevrolet onix')).toEqual(onix);
    expect(new Set(searchModels('song').map((m) => m.model))).toEqual(new Set(['Song Plus', 'Song Pro']));
    expect(new Set(searchModels('hb20').map((m) => m.model))).toEqual(new Set(['HB20', 'HB20S']));
    expect(searchModels('onix xyz')).toEqual([]);
  });

  it('narrows by model year', () => {
    const corolla2018 = searchModels('corolla 2018');
    expect(corolla2018.length).toBeGreaterThan(0);
    expect(corolla2018.every((m) => m.yearFrom <= 2018 && (m.yearTo === null || m.yearTo >= 2018))).toBe(true);
    expect(corolla2018.length).toBeLessThan(searchModels('corolla').length);
    const onix2018 = searchModels('onix 2018');
    expect(onix2018.length).toBeGreaterThan(0);
    expect(onix2018.every((m) => m.yearFrom <= 2018 && (m.yearTo === null || m.yearTo >= 2018))).toBe(true);
  });

  it('keeps seed order, best sellers first', () => {
    const order = ids([...CAR_MODELS]);
    const found = ids(searchModels('1.0'));
    expect(found).toEqual([...found].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });
});

test('findModel looks up by id', () => {
  const first = CAR_MODELS[0];
  expect(findModel(first.id)).toBe(first);
  expect(findModel('nope')).toBeUndefined();
});

test('modelYears says whether the model is still on sale', () => {
  expect(modelYears(base)).toBe('2020 em diante');
  expect(modelYears({ ...base, yearFrom: 2013, yearTo: 2019 })).toBe('2013 a 2019');
});

test('suggestedNickname agrees with the model name', () => {
  expect(suggestedNickname(base)).toBe('Meu Carro');
  expect(suggestedNickname({ ...base, model: 'Strada', feminine: true })).toBe('Minha Strada');
});

test('modelSpecs writes values the way the user would type them, keeping gaps empty', () => {
  expect(modelSpecs(base)).toEqual({
    oilSpec: '5W-30 sintético',
    tireFrontPsi: 32,
    tireRearPsi: 30,
    wiperDriver: '22"',
    wiperPassenger: '16"',
    battery: '60 Ah',
  });
  const empty = { ...base, oil: null, tireFrontPsi: null, wiperDriver: null, wiperPassenger: null, batteryAh: null };
  expect(modelSpecs(empty)).toEqual({
    oilSpec: null,
    tireFrontPsi: null,
    tireRearPsi: 30,
    wiperDriver: null,
    wiperPassenger: null,
    battery: null,
  });
});

describe('presetsFor', () => {
  it('returns every preset for an unknown model or one without overrides', () => {
    expect(presetsFor(undefined)).toEqual(PRESETS);
    expect(presetsFor(base)).toEqual(PRESETS);
  });

  it('drops what the model does not have and applies its manual intervals', () => {
    const chain = { ...base, presets: { timing_belt: null } };
    expect(presetsFor(chain).map((p) => p.key)).toEqual(['oil', 'air_filters', 'tire_rotation', 'brakes']);

    const belt = { normal: { km: 120000, months: null }, severe: { km: 120000, months: null } };
    const longBelt = presetsFor({ ...base, presets: { timing_belt: belt } });
    expect(longBelt).toHaveLength(PRESETS.length);
    expect(longBelt.find((p) => p.key === 'timing_belt')).toEqual({ key: 'timing_belt', name: 'Correia dentada', ...belt });
    expect(longBelt.find((p) => p.key === 'oil')).toBe(PRESETS[0]);
  });
});
