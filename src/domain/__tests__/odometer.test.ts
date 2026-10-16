import {
  MONTHLY_KM_OPTIONS,
  checkReading,
  dailyRate,
  isProjectionStale,
  projectOdometer,
  type OdometerReading,
} from '../odometer';

const today = '2026-10-15';
const r = (km: number, readAt: string): OdometerReading => ({ km, readAt });

describe('MONTHLY_KM_OPTIONS', () => {
  it('has the three chips', () => {
    expect(MONTHLY_KM_OPTIONS.map((o) => o.value)).toEqual([400, 1000, 1600]);
  });
});

describe('dailyRate', () => {
  it('falls back to the monthly estimate without enough readings', () => {
    expect(dailyRate([], 1500, today)).toBe(50);
    expect(dailyRate([r(10000, '2026-10-01')], 1500, today)).toBe(50);
  });

  it('falls back when readings span less than 14 days', () => {
    expect(dailyRate([r(10000, '2026-10-02'), r(10010, '2026-10-15')], 1500, today)).toBe(50);
  });

  it('uses the regression slope when readings span 14+ days', () => {
    expect(dailyRate([r(10000, '2026-10-01'), r(10700, '2026-10-15')], 1500, today)).toBe(50);
    expect(dailyRate([r(10000, '2026-10-01'), r(10140, '2026-10-15')], 1500, today)).toBe(10);
    expect(dailyRate([r(1000, '2026-09-01'), r(1100, '2026-09-11'), r(1300, '2026-09-21')], 0, today)).toBeCloseTo(15);
  });

  it('ignores readings older than 90 days', () => {
    // 2026-07-16 is 91 days before today; 2026-07-17 is exactly 90.
    expect(dailyRate([r(0, '2026-07-16'), r(10000, '2026-10-01'), r(10700, '2026-10-15')], 1500, today)).toBe(50);
    expect(dailyRate([r(0, '2026-07-16'), r(10000, '2026-10-15')], 1500, today)).toBe(50);
    expect(dailyRate([r(1000, '2026-07-17'), r(1900, '2026-10-15')], 1500, today)).toBe(10);
  });

  it('clamps a negative slope to 0', () => {
    expect(dailyRate([r(10000, '2026-09-01'), r(9000, '2026-10-01')], 1500, today)).toBe(0);
  });
});

describe('projectOdometer', () => {
  it('is 0 without readings', () => {
    expect(projectOdometer([], 1500, today)).toBe(0);
  });

  it('adds elapsed days times the rate, rounded', () => {
    expect(projectOdometer([r(10000, '2026-10-05')], 1500, today)).toBe(10500);
    // 14 days * 1000/30 = 466.67
    expect(projectOdometer([r(10000, '2026-10-01')], 1000, today)).toBe(10467);
  });

  it('starts from the latest reading, ties broken by highest km', () => {
    expect(projectOdometer([r(200, today), r(100, today)], 1500, today)).toBe(200);
    expect(projectOdometer([r(10000, '2026-10-14'), r(9000, '2026-10-01')], 1500, today)).toBe(10050);
  });

  it('never projects backwards for a future reading', () => {
    expect(projectOdometer([r(5000, '2026-10-20')], 1500, today)).toBe(5000);
  });
});

describe('isProjectionStale', () => {
  it('is stale without readings', () => {
    expect(isProjectionStale([], today)).toBe(true);
  });

  it('turns stale after 30 days', () => {
    expect(isProjectionStale([r(1000, '2026-09-15')], today)).toBe(false); // 30 days
    expect(isProjectionStale([r(1000, '2026-09-14')], today)).toBe(true); // 31 days
    expect(isProjectionStale([r(1000, '2026-09-14'), r(1500, '2026-10-10')], today)).toBe(false);
  });
});

describe('checkReading', () => {
  const readings = [r(10000, '2026-09-01'), r(12000, '2026-10-01')];

  it('accepts anything when there are no readings', () => {
    expect(checkReading([], 0, today)).toBe('ok');
  });

  it('checks a new latest reading against the previous max', () => {
    expect(checkReading(readings, 13000, today)).toBe('ok');
    expect(checkReading(readings, 12000, today)).toBe('ok');
    expect(checkReading(readings, 11999, today)).toBe('below_previous');
  });

  it('checks a retroactive reading against both neighbours', () => {
    expect(checkReading(readings, 11000, '2026-09-15')).toBe('ok');
    expect(checkReading(readings, 9000, '2026-09-15')).toBe('below_previous');
    expect(checkReading(readings, 12500, '2026-09-15')).toBe('above_next');
    expect(checkReading(readings, 9000, '2026-08-01')).toBe('ok');
    expect(checkReading(readings, 10001, '2026-08-01')).toBe('above_next');
  });

  it('treats a same-day reading as previous', () => {
    expect(checkReading(readings, 11999, '2026-10-01')).toBe('below_previous');
  });
});
