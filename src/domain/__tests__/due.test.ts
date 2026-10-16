import { addDays } from '../dates';
import { computeDue, urgencyOf, type ItemSchedule } from '../due';

const today = '2026-10-15';
const atToday = [{ km: 40000, readAt: today }];
const item = (over: Partial<ItemSchedule>): ItemSchedule => ({
  intervalKm: null,
  intervalMonths: null,
  baselineKm: 40000,
  baselineDate: today,
  ...over,
});

// monthlyEstimate 1500 → 50 km/day, so km dates are exact.
describe('computeDue', () => {
  it('picks the time limit when it comes first', () => {
    expect(computeDue(item({ intervalKm: 10000, intervalMonths: 6 }), atToday, 1500, today)).toEqual({
      dueDate: '2027-04-15',
      daysLeft: 182,
      dueKm: 50000,
      kmLeft: 10000,
      urgency: 'ok',
    });
  });

  it('picks the km limit when it comes first', () => {
    expect(computeDue(item({ intervalKm: 5000, intervalMonths: 12 }), atToday, 1500, today)).toEqual({
      dueDate: '2027-01-23',
      daysLeft: 100,
      dueKm: 45000,
      kmLeft: 5000,
      urgency: 'ok',
    });
  });

  it('rounds a future km date up', () => {
    expect(computeDue(item({ intervalKm: 5010 }), atToday, 1500, today).daysLeft).toBe(101);
  });

  it('handles a km-only item', () => {
    const due = computeDue(item({ intervalKm: 10000 }), atToday, 1500, today);
    expect(due.dueDate).toBe(addDays(today, 200));
    expect(due.daysLeft).toBe(200);
  });

  it('handles a time-only item', () => {
    expect(computeDue(item({ intervalMonths: 1 }), atToday, 1500, today)).toEqual({
      dueDate: '2026-11-15',
      daysLeft: 31,
      dueKm: null,
      kmLeft: null,
      urgency: 'attention',
    });
  });

  it('has no date without intervals', () => {
    const due = computeDue(item({}), atToday, 1500, today);
    expect(due.dueDate).toBeNull();
    expect(due.daysLeft).toBeNull();
    expect(due.urgency).toBe('ok');
  });

  it('never reaches the km with rate 0 and km still ahead', () => {
    const due = computeDue(item({ intervalKm: 10000 }), atToday, 0, today);
    expect(due).toMatchObject({ dueDate: null, daysLeft: null, kmLeft: 10000, urgency: 'ok' });
    expect(computeDue(item({ intervalKm: 10000, intervalMonths: 6 }), atToday, 0, today).dueDate).toBe('2027-04-15');
  });

  it('is due today with rate 0 and km already reached', () => {
    expect(computeDue(item({ baselineKm: 30000, intervalKm: 10000 }), atToday, 0, today)).toMatchObject({
      dueDate: today,
      daysLeft: 0,
      kmLeft: 0,
      urgency: 'critical',
    });
    expect(computeDue(item({ baselineKm: 29500, intervalKm: 10000 }), atToday, 0, today)).toMatchObject({
      dueDate: today,
      kmLeft: -500,
    });
  });

  it('dates an overdue km item in the past, rounded down', () => {
    expect(computeDue(item({ baselineKm: 30000, intervalKm: 5000 }), atToday, 1500, today)).toMatchObject({
      dueDate: addDays(today, -100),
      daysLeft: -100,
      kmLeft: -5000,
      urgency: 'critical',
    });
    expect(computeDue(item({ baselineKm: 30000, intervalKm: 4990 }), atToday, 1500, today).daysLeft).toBe(-101);
  });

  it('flags an overdue time item', () => {
    const due = computeDue(item({ baselineDate: '2026-01-15', intervalMonths: 6 }), atToday, 1500, today);
    expect(due.dueDate).toBe('2026-07-15');
    expect(due.daysLeft).toBe(-92);
    expect(due.urgency).toBe('critical');
  });

  it('uses the projected odometer, not the last reading', () => {
    const due = computeDue(item({ intervalKm: 5000 }), [{ km: 40000, readAt: '2026-10-05' }], 1500, today);
    expect(due.kmLeft).toBe(4500);
    expect(due.daysLeft).toBe(90);
  });
});

describe('urgencyOf', () => {
  it('uses day boundaries', () => {
    expect(urgencyOf(-3, null)).toBe('critical');
    expect(urgencyOf(15, null)).toBe('critical');
    expect(urgencyOf(16, null)).toBe('attention');
    expect(urgencyOf(45, null)).toBe('attention');
    expect(urgencyOf(46, null)).toBe('ok');
  });

  it('uses km boundaries', () => {
    expect(urgencyOf(null, 500)).toBe('critical');
    expect(urgencyOf(null, 501)).toBe('attention');
    expect(urgencyOf(null, 1500)).toBe('attention');
    expect(urgencyOf(null, 1501)).toBe('ok');
  });

  it('takes the most urgent of the two and ignores nulls', () => {
    expect(urgencyOf(200, 400)).toBe('critical');
    expect(urgencyOf(10, 5000)).toBe('critical');
    expect(urgencyOf(100, 1000)).toBe('attention');
    expect(urgencyOf(null, null)).toBe('ok');
  });
});
