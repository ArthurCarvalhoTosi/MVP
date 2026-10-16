import { addDays, addMonths, daysBetween, todayISO } from '../dates';

describe('todayISO', () => {
  it('uses the local calendar date', () => {
    expect(todayISO(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('defaults to now', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-15', 0)).toBe('2026-10-15');
  });

  it('is not shifted by DST transitions', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); // US spring forward
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02'); // US fall back
  });
});

describe('addMonths', () => {
  it('clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('handles leap years', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('rolls over years in both directions', () => {
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-10-15', 48)).toBe('2030-10-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
  });
});

describe('daysBetween', () => {
  it('counts whole days, negative when going back', () => {
    expect(daysBetween('2026-10-15', '2026-10-15')).toBe(0);
    expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('is exact across DST ranges', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-10-01', '2026-11-30')).toBe(60);
  });
});
