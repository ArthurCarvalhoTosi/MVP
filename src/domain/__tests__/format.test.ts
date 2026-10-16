import type { Due } from '../due';
import { dueLabel, formatBRL, formatDate, formatKm, formatPair, intervalLabel } from '../format';

const NBSP = '\u00a0';

describe('formatKm', () => {
  it('uses pt-BR thousands separator', () => {
    expect(formatKm(46250)).toBe('46.250 km');
    expect(formatKm(1200)).toBe('1.200 km');
    expect(formatKm(0)).toBe('0 km');
  });
});

describe('formatBRL', () => {
  it('formats cents as reais with a no-break space', () => {
    expect(formatBRL(123456)).toBe(`R$${NBSP}1.234,56`);
    expect(formatBRL(5)).toBe(`R$${NBSP}0,05`);
    expect(formatBRL(0)).toBe(`R$${NBSP}0,00`);
  });
});

describe('formatDate', () => {
  it('formats with Intl pt-BR short month', () => {
    expect(formatDate('2026-10-15')).toBe('15 de out. de 2026');
  });

  it('never shifts the day', () => {
    expect(formatDate('2026-01-01')).toBe('1 de jan. de 2026');
    expect(formatDate('2026-12-31')).toBe('31 de dez. de 2026');
  });
});

describe('dueLabel', () => {
  const due = (daysLeft: number | null, kmLeft: number | null = null): Due => ({
    dueDate: null,
    daysLeft,
    dueKm: null,
    kmLeft,
    urgency: 'ok',
  });
  const primary = (d: number | null) => dueLabel(due(d)).primary;
  const secondary = (km: number | null) => dueLabel(due(10, km)).secondary;

  it('describes days left', () => {
    expect(primary(-1)).toBe('Vencido há 1 dia');
    expect(primary(-5)).toBe('Vencido há 5 dias');
    expect(primary(0)).toBe('Vence hoje');
    expect(primary(1)).toBe('Vence amanhã');
    expect(primary(2)).toBe('Vence em 2 dias');
    expect(primary(60)).toBe('Vence em 60 dias');
    expect(primary(61)).toBe('Vence em ~2 meses');
    expect(primary(120)).toBe('Vence em ~4 meses');
    expect(primary(null)).toBe('Sem previsão');
  });

  it('says "Vencido" once the km limit is reached, whatever the date says', () => {
    expect(dueLabel(due(0, -1200))).toEqual({ primary: 'Vencido', secondary: 'Passou 1.200 km' });
    expect(dueLabel(due(30, -10)).primary).toBe('Vencido');
    expect(dueLabel(due(null, -1)).primary).toBe('Vencido');
    expect(dueLabel(due(0, 0))).toEqual({ primary: 'Vence hoje', secondary: 'Faltam 0 km' });
    // An overdue date keeps its own count; km still ahead keeps the date wording.
    expect(dueLabel(due(-3, -500)).primary).toBe('Vencido há 3 dias');
    expect(dueLabel(due(0, 100)).primary).toBe('Vence hoje');
  });

  it('describes km left', () => {
    expect(secondary(null)).toBeNull();
    expect(secondary(-1200)).toBe('Passou 1.200 km');
    expect(secondary(0)).toBe('Faltam 0 km');
    expect(secondary(3500)).toBe('Faltam 3.500 km');
  });
});

describe('intervalLabel', () => {
  it('joins km and months with "ou"', () => {
    expect(intervalLabel(10000, 12)).toBe('A cada 10.000 km ou 12 meses');
    expect(intervalLabel(5000, 6)).toBe('A cada 5.000 km ou 6 meses');
  });

  it('shows only the interval that exists', () => {
    expect(intervalLabel(10000, null)).toBe('A cada 10.000 km');
    expect(intervalLabel(null, 6)).toBe('A cada 6 meses');
    expect(intervalLabel(null, null)).toBe('Sem intervalo');
  });

  it('reads whole multiples above 12 months as years', () => {
    expect(intervalLabel(40000, 48)).toBe('A cada 40.000 km ou 4 anos');
    expect(intervalLabel(null, 24)).toBe('A cada 2 anos');
    expect(intervalLabel(null, 12)).toBe('A cada 12 meses');
    expect(intervalLabel(null, 18)).toBe('A cada 18 meses');
    expect(intervalLabel(null, 1)).toBe('A cada 1 mês');
  });
});

describe('formatPair', () => {
  it('joins both sides with an optional unit', () => {
    expect(formatPair(32, 30, 'psi')).toBe('32 / 30 psi');
    expect(formatPair('22"', '16"')).toBe('22" / 16"');
  });

  it('marks a missing side and is null when both are missing', () => {
    expect(formatPair(32, null, 'psi')).toBe('32 / – psi');
    expect(formatPair(undefined, '16"')).toBe('– / 16"');
    expect(formatPair(null, undefined, 'psi')).toBeNull();
  });
});
