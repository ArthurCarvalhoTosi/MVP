export type ISODate = string; // 'YYYY-MM-DD', local calendar date, no time/zone

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;

// Calendar math runs on UTC midnights so DST transitions never add or drop a day.
function toUTC(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function todayISO(now: Date = new Date()): ISODate {
  return fmt(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * DAY_MS);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const total = m - 1 + n;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12; // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fmt(year, month + 1, Math.min(day, lastDay));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return (toUTC(to) - toUTC(from)) / DAY_MS;
}
