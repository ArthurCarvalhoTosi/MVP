import type { ISODate } from './dates';
import { computeDue, type Due, type ItemSchedule, type Urgency } from './due';
import type { OdometerReading } from './odometer';

export interface FeedEntry<T> {
  item: T;
  due: Due;
}

export interface Feed<T> {
  critical: FeedEntry<T>[];
  attention: FeedEntry<T>[];
  ok: FeedEntry<T>[];
  /** Soonest ok item with a forecast, for the all-clear state. */
  next: FeedEntry<T> | null;
}

// No forecast (null) sorts last.
function byDueDate(a: ISODate | null, b: ISODate | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export function buildFeed<T extends ItemSchedule & { name: string }>(
  items: T[],
  readings: OdometerReading[],
  monthlyEstimate: number,
  today: ISODate,
): Feed<T> {
  const entries = items
    .map((item) => ({ item, due: computeDue(item, readings, monthlyEstimate, today) }))
    .sort((a, b) => byDueDate(a.due.dueDate, b.due.dueDate) || a.item.name.localeCompare(b.item.name, 'pt-BR'));
  const of = (u: Urgency) => entries.filter((e) => e.due.urgency === u);
  const ok = of('ok');
  return { critical: of('critical'), attention: of('attention'), ok, next: ok[0]?.due.dueDate ? ok[0] : null };
}
