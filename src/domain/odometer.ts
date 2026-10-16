import { addDays, daysBetween, type ISODate } from './dates';

export interface OdometerReading {
  km: number;
  readAt: ISODate;
}

export const MONTHLY_KM_OPTIONS: readonly { label: string; value: number }[] = [
  { label: 'Menos de 500 km', value: 400 },
  { label: 'Cerca de 1.000 km', value: 1000 },
  { label: '1.500 km ou mais', value: 1600 },
];

const WINDOW_DAYS = 90;
// Readings closer than this give near-zero/noisy slopes; fall back to the user's estimate instead.
const MIN_SPAN_DAYS = 14;
const STALE_DAYS = 30;

function latestReading(readings: OdometerReading[]): OdometerReading | undefined {
  return readings.reduce<OdometerReading | undefined>(
    (best, r) =>
      !best || r.readAt > best.readAt || (r.readAt === best.readAt && r.km > best.km) ? r : best,
    undefined,
  );
}

export function dailyRate(readings: OdometerReading[], monthlyEstimate: number, today: ISODate): number {
  const from = addDays(today, -WINDOW_DAYS);
  const recent = readings.filter((r) => r.readAt >= from && r.readAt <= today);
  const xs = recent.map((r) => daysBetween(from, r.readAt));
  if (recent.length < 2 || Math.max(...xs) - Math.min(...xs) < MIN_SPAN_DAYS) {
    return monthlyEstimate / 30;
  }
  const n = recent.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = recent.reduce((s, r) => s + r.km, 0) / n;
  let num = 0;
  let den = 0;
  recent.forEach((r, i) => {
    num += (xs[i] - meanX) * (r.km - meanY);
    den += (xs[i] - meanX) ** 2;
  });
  return Math.max(0, num / den);
}

export function projectOdometer(readings: OdometerReading[], monthlyEstimate: number, today: ISODate): number {
  const latest = latestReading(readings);
  if (!latest) return 0;
  const elapsed = Math.max(0, daysBetween(latest.readAt, today));
  return Math.round(latest.km + elapsed * dailyRate(readings, monthlyEstimate, today));
}

export function isProjectionStale(readings: OdometerReading[], today: ISODate): boolean {
  const latest = latestReading(readings);
  return !latest || daysBetween(latest.readAt, today) > STALE_DAYS;
}

export type ReadingCheck = 'ok' | 'below_previous' | 'above_next';

export function checkReading(readings: OdometerReading[], km: number, readAt: ISODate): ReadingCheck {
  // Math.max() of nothing is -Infinity and Math.min() is Infinity, so empty sides never fail.
  const prevMax = Math.max(...readings.filter((r) => r.readAt <= readAt).map((r) => r.km));
  if (km < prevMax) return 'below_previous';
  const nextMin = Math.min(...readings.filter((r) => r.readAt > readAt).map((r) => r.km));
  if (km > nextMin) return 'above_next';
  return 'ok';
}
