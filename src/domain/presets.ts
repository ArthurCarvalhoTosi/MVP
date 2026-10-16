export interface Preset {
  key: string;
  name: string;
  normal: { km: number | null; months: number | null };
  severe: { km: number | null; months: number | null };
}

export const PRESETS: readonly Preset[] = [
  { key: 'oil', name: 'Troca de óleo e filtro', normal: { km: 10000, months: 12 }, severe: { km: 5000, months: 6 } },
  { key: 'air_filters', name: 'Filtros de ar e cabine', normal: { km: 10000, months: 12 }, severe: { km: 5000, months: 6 } },
  { key: 'tire_rotation', name: 'Rodízio de pneus', normal: { km: 10000, months: null }, severe: { km: 10000, months: null } },
  { key: 'brakes', name: 'Revisão dos freios', normal: { km: 20000, months: null }, severe: { km: 10000, months: null } },
  { key: 'timing_belt', name: 'Correia dentada', normal: { km: 40000, months: 48 }, severe: { km: 40000, months: 48 } },
];

export function presetSchedule(
  p: Preset,
  severeUse: boolean,
): { intervalKm: number | null; intervalMonths: number | null } {
  const s = severeUse ? p.severe : p.normal;
  return { intervalKm: s.km, intervalMonths: s.months };
}
