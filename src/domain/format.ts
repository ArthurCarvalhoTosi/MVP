import type { ISODate } from './dates';
import type { Due } from './due';

const kmFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const brlFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// timeZone UTC pairs with the UTC midnight below so the calendar day never shifts.
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

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

export function dueLabel(due: Due): { primary: string; secondary: string | null } {
  const { kmLeft } = due;
  return {
    primary: daysLabel(due.daysLeft),
    secondary: kmLeft === null ? null : kmLeft < 0 ? `Passou ${formatKm(-kmLeft)}` : `Faltam ${formatKm(kmLeft)}`,
  };
}
