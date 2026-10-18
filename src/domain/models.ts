import seed from './models.json';
import { PRESETS, type Preset } from './presets';

/** One model + engine + generation of the curated seed; specs are null when no source confirmed them. */
export interface CarModel {
  /** Stored in vehicles.model_ref: never rename or reuse one. */
  id: string;
  brand: string;
  model: string;
  engine: string;
  /** Model years; yearTo is null while still on sale. */
  yearFrom: number;
  yearTo: number | null;
  /** "Minha Strada", not "Meu Strada". */
  feminine?: boolean;
  oil: string | null;
  tireFrontPsi: number | null;
  tireRearPsi: number | null;
  /** Inches. */
  wiperDriver: number | null;
  wiperPassenger: number | null;
  batteryAh: number | null;
  /** Where the owner's manual departs from PRESETS: its schedule, or null when the item doesn't apply (timing chain, electric). */
  presets?: Partial<Record<string, Pick<Preset, 'normal' | 'severe'> | null>>;
  /** URLs a reviewer can check each value against. */
  sources: Partial<Record<string, string[]>>;
}

// Typed here, sanity-checked value by value in models.test.ts.
export const SEED_VERSION: number = seed.version;
export const CAR_MODELS: readonly CarModel[] = seed.models;

/** Lowercase letters and digits only, without accents: "T-Cross" and "tcross" compare equal. */
const compact = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const searchable = CAR_MODELS.map((m) => ({
  m,
  text: compact(`${m.brand} ${m.model} ${m.engine}`),
}));

/** Models matching every word typed, in seed order (best sellers first); a year like "2018" also narrows by model year. */
export function searchModels(query: string): CarModel[] {
  const words = query.split(/\s+/).map(compact).filter(Boolean);
  if (words.length === 0) return [];
  return searchable
    .filter(({ m, text }) =>
      words.every((w) => text.includes(w) || (/^(19|20)\d\d$/.test(w) && fitsYear(m, Number(w)))),
    )
    .map(({ m }) => m);
}

function fitsYear(m: CarModel, year: number) {
  return year >= m.yearFrom && (m.yearTo === null || year <= m.yearTo);
}

export function findModel(id: string): CarModel | undefined {
  return CAR_MODELS.find((m) => m.id === id);
}

/** "2020 em diante" or "2013 a 2019". */
export function modelYears(m: CarModel): string {
  return m.yearTo === null ? `${m.yearFrom} em diante` : `${m.yearFrom} a ${m.yearTo}`;
}

export function suggestedNickname(m: CarModel): string {
  return `${m.feminine ? 'Minha' : 'Meu'} ${m.model}`;
}

/** The seed's values in vehicle_specs' shape, as the user would type them. */
export function modelSpecs(m: CarModel) {
  return {
    oilSpec: m.oil,
    tireFrontPsi: m.tireFrontPsi,
    tireRearPsi: m.tireRearPsi,
    wiperDriver: m.wiperDriver === null ? null : `${m.wiperDriver}"`,
    wiperPassenger: m.wiperPassenger === null ? null : `${m.wiperPassenger}"`,
    battery: m.batteryAh === null ? null : `${m.batteryAh} Ah`,
  };
}

/** PRESETS adjusted to the model's manual; all of them when the model is unknown. */
export function presetsFor(m: CarModel | undefined): Preset[] {
  return PRESETS.flatMap((p) => {
    const own = m?.presets?.[p.key];
    if (own === null) return [];
    return [own ? { ...p, ...own } : p];
  });
}
