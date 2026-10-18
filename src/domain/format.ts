import type { ISODate } from './dates';
import type { Due } from './due';

const kmFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const brlFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// timeZone UTC pairs with the UTC midnight below so the calendar day never shifts.
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatKm(km: number): string {
  return `${kmFormat.format(km)} km`;
}

export function formatBRL(cents: number): string {
  return brlFormat.format(cents / 100);
}

export function formatDate(d: ISODate): string {
  const [y, m, day] = d.split('-').map(Number);
  return dateFormat.format(new Date(Date.UTC(y, m - 1, day)));
}

function daysLabel(d: number | null): string {
  if (d === null) return 'Sem previsão';
  if (d < 0) return `Vencido há ${-d} ${d === -1 ? 'dia' : 'dias'}`;
  if (d === 0) return 'Vence hoje';
  if (d === 1) return 'Vence amanhã';
  if (d <= 60) return `Vence em ${d} dias`;
  return `Vence em ~${Math.round(d / 30)} meses`; // d > 60 already rounds to >= 2
}

// 12 stays "12 meses" (how manuals say it); whole multiples above that read as years.
function monthsLabel(m: number): string {
  if (m > 12 && m % 12 === 0) return `${m / 12} anos`;
  return m === 1 ? '1 mês' : `${m} meses`;
}

export function intervalLabel(intervalKm: number | null, intervalMonths: number | null): string {
  const parts = [
    intervalKm === null ? null : formatKm(intervalKm),
    intervalMonths === null ? null : monthsLabel(intervalMonths),
  ].filter((p) => p !== null);
  return parts.length ? `A cada ${parts.join(' ou ')}` : 'Sem intervalo';
}

/** "32 / 30 psi"; a missing side shows "–", both missing is null. */
export function formatPair(
  a?: string | number | null,
  b?: string | number | null,
  unit?: string,
): string | null {
  if (a == null && b == null) return null;
  return `${a ?? '–'} / ${b ?? '–'}${unit ? ` ${unit}` : ''}`;
}

export function dueLabel(due: Due): { primary: string; secondary: string | null } {
  const { kmLeft, daysLeft } = due;
  const passed = kmLeft !== null && kmLeft < 0 ? `Passou ${formatKm(-kmLeft)}` : null;
  // Overdue by km, the day count would come from the average km/day ("Vencido há 2813 dias");
  // the km past the limit is what's actually known.
  if (passed && due.dueBy === 'km') return { primary: passed, secondary: null };
  return {
    primary: daysLabel(daysLeft),
    secondary: kmLeft === null ? null : (passed ?? `Faltam ${formatKm(kmLeft)}`),
  };
}
