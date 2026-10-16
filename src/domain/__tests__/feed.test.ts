import type { ItemSchedule } from '../due';
import { buildFeed } from '../feed';

const today = '2026-10-15';
const readings = [{ km: 40000, readAt: today }];
const item = (name: string, over: Partial<ItemSchedule>) => ({
  name,
  intervalKm: null,
  intervalMonths: null,
  baselineKm: 40000,
  baselineDate: today,
  ...over,
});
const names = (entries: { item: { name: string } }[]) => entries.map((e) => e.item.name);

// monthlyEstimate 1500 → 50 km/day.
describe('buildFeed', () => {
  it('groups by urgency, each group sorted by due date', () => {
    const feed = buildFeed(
      [
        item('Later ok', { intervalMonths: 12 }), // 2027-10-15
        item('Soon ok', { intervalKm: 5000 }), // 100 days
        item('Attention', { intervalKm: 1000 }), // 20 days
        item('Overdue', { intervalKm: 5000, baselineKm: 30000 }), // 5000 km past
        item('Due today', { intervalKm: 5000, baselineKm: 35000 }), // 0 km left
      ],
      readings,
      1500,
      today,
    );

    expect(names(feed.critical)).toEqual(['Overdue', 'Due today']);
    expect(names(feed.attention)).toEqual(['Attention']);
    expect(names(feed.ok)).toEqual(['Soon ok', 'Later ok']);
    expect(feed.next?.item.name).toBe('Soon ok');
    expect(feed.next?.due.daysLeft).toBe(100);
  });

  it('breaks due-date ties by name in pt-BR order (accents included)', () => {
    const feed = buildFeed(
      [item('Pneus', { intervalKm: 5000 }), item('Óleo', { intervalKm: 5000 }), item('Filtro', { intervalKm: 5000 })],
      readings,
      1500,
      today,
    );
    expect(names(feed.ok)).toEqual(['Filtro', 'Óleo', 'Pneus']);
  });

  it('puts items without a forecast last, then by name', () => {
    // Rate 0: km-only items never come due, so they have no date.
    const feed = buildFeed(
      [item('Zeta', { intervalKm: 5000 }), item('Alfa', { intervalKm: 5000 }), item('Meio', { intervalMonths: 6 })],
      readings,
      0,
      today,
    );
    expect(names(feed.ok)).toEqual(['Meio', 'Alfa', 'Zeta']);
    expect(feed.next?.item.name).toBe('Meio');
  });

  it('has no next when no ok item has a forecast', () => {
    const feed = buildFeed([item('Alfa', { intervalKm: 5000 })], readings, 0, today);
    expect(names(feed.ok)).toEqual(['Alfa']);
    expect(feed.next).toBeNull();
  });

  it('returns empty groups for no items', () => {
    expect(buildFeed([], readings, 1500, today)).toEqual({ critical: [], attention: [], ok: [], next: null });
  });

  it('keeps the caller item shape', () => {
    const feed = buildFeed([{ ...item('Óleo', { intervalMonths: 12 }), id: 'abc' }], readings, 1500, today);
    expect(feed.ok[0].item.id).toBe('abc');
  });
});
