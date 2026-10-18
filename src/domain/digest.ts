import { addDays, dayOfWeek, todayISO, type ISODate } from './dates';
import type { ItemSchedule } from './due';
import { buildFeed, type FeedEntry } from './feed';
import { dueLabel } from './format';
import type { OdometerReading } from './odometer';

/** Local hour of the Saturday check-up. */
export const DIGEST_HOUR = 9;
// One notification per Saturday stays far below iOS's 64 pending; the app reschedules on every open.
const DIGEST_WEEKS = 8;
export const SNOOZE_DAYS = 15;
// More names than this turn the notification into a wall of text; the check-up has the full list.
const MAX_NAMES = 3;

export interface DigestVehicle {
  id: string;
  nickname: string;
  monthlyKmEstimate: number;
}

export interface DigestItem extends ItemSchedule {
  id: string;
  vehicleId: string;
  name: string;
  snoozedUntil: ISODate | null;
}

export interface DigestReading extends OdometerReading {
  vehicleId: string;
}

export type DigestNotification = {
  /** The Saturday it fires on, at DIGEST_HOUR local time. */
  date: ISODate;
  title: string;
  body: string;
} & ({ kind: 'summary' } | { kind: 'critical'; itemId: string; vehicleId: string });

/** Out of the reminders before `snoozedUntil`, back on that day. The due date and the dashboard ignore it. */
export function isSnoozed(item: { snoozedUntil: ISODate | null }, day: ISODate): boolean {
  return item.snoozedUntil !== null && day < item.snoozedUntil;
}

/**
 * What the check-up lists on `day`: critical and attention items that aren't snoozed, per car,
 * in the cars' order. Cars with nothing pending are left out.
 */
export function pendingByVehicle<V extends DigestVehicle, I extends DigestItem>(
  vehicles: V[],
  items: I[],
  readings: DigestReading[],
  day: ISODate,
): { vehicle: V; entries: FeedEntry<I>[] }[] {
  return vehicles
    .map((vehicle) => {
      const feed = buildFeed(
        items.filter((i) => i.vehicleId === vehicle.id && !isSnoozed(i, day)),
        readings.filter((r) => r.vehicleId === vehicle.id),
        vehicle.monthlyKmEstimate,
        day,
      );
      return { vehicle, entries: [...feed.critical, ...feed.attention] };
    })
    .filter((group) => group.entries.length > 0);
}

// Today counts only while its check-up time is still ahead.
function upcomingSaturdays(now: Date): ISODate[] {
  const today = todayISO(now);
  let first = addDays(today, 6 - dayOfWeek(today));
  if (first === today && now.getHours() >= DIGEST_HOUR) first = addDays(first, 7);
  return Array.from({ length: DIGEST_WEEKS }, (_, i) => addDays(first, 7 * i));
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The Saturday reminders for the next weeks, across all cars. A Saturday with nothing pending has none.
 * Exactly one critical item gets a notification of its own (it can carry Feito / Adiar 15 dias);
 * anything else is a summary, since one Feito can't stand for several items.
 */
export function buildDigest(
  vehicles: DigestVehicle[],
  items: DigestItem[],
  readings: DigestReading[],
  now: Date,
): DigestNotification[] {
  return upcomingSaturdays(now).flatMap((date): DigestNotification[] => {
    const groups = pendingByVehicle(vehicles, items, readings, date);
    const entries = groups.flatMap(({ vehicle, entries }) =>
      entries.map((e) => ({ ...e, vehicle })),
    );
    if (entries.length === 0) return [];
    const critical = entries.filter((e) => e.due.urgency === 'critical');

    if (critical.length === 1) {
      const { item, due, vehicle } = critical[0];
      const { primary, secondary } = dueLabel(due);
      const status = [primary, secondary]
        .filter((s) => s !== null)
        .map(lowerFirst)
        .join(', ');
      const others = entries.length - 1;
      return [
        {
          kind: 'critical',
          date,
          itemId: item.id,
          vehicleId: vehicle.id,
          title: item.name,
          body: `${vehicle.nickname}: ${status}.${others > 0 ? ` Mais ${others} em atenção.` : ''}`,
        },
      ];
    }

    // Critical first, so a cut list never hides one behind an attention item.
    const ordered = [...critical, ...entries.filter((e) => e.due.urgency !== 'critical')];
    const names = ordered.map((e) =>
      groups.length > 1 ? `${e.item.name} (${e.vehicle.nickname})` : e.item.name,
    );
    const rest = names.length - MAX_NAMES;
    const list =
      rest > 0 ? `${names.slice(0, MAX_NAMES).join(', ')} e mais ${rest}` : names.join(', ');
    const count =
      names.length === 1
        ? '1 troca precisa de atenção'
        : `${names.length} trocas precisam de atenção`;
    const where = groups.length > 1 ? ` em ${groups.length} carros` : '';
    return [
      { kind: 'summary', date, title: 'Check-up da semana', body: `${count}${where}: ${list}.` },
    ];
  });
}
