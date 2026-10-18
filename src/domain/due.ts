import { addDays, addMonths, daysBetween, type ISODate } from './dates';
import { dailyRate, projectOdometer, type OdometerReading } from './odometer';

export type Urgency = 'critical' | 'attention' | 'ok';

export interface ItemSchedule {
  intervalKm: number | null;
  intervalMonths: number | null;
  baselineKm: number;
  baselineDate: ISODate;
}

export interface Due {
  dueDate: ISODate | null;
  daysLeft: number | null;
  dueKm: number | null;
  kmLeft: number | null;
  /** Which limit sets dueDate. A 'km' date is an estimate from the average km/day. */
  dueBy: 'km' | 'time' | null;
  urgency: Urgency;
}

export function computeDue(
  item: ItemSchedule,
  readings: OdometerReading[],
  monthlyEstimate: number,
  today: ISODate,
): Due {
  const timeDate = item.intervalMonths != null ? addMonths(item.baselineDate, item.intervalMonths) : null;

  let kmDate: ISODate | null = null;
  let dueKm: number | null = null;
  let kmLeft: number | null = null;
  if (item.intervalKm != null) {
    dueKm = item.baselineKm + item.intervalKm;
    kmLeft = dueKm - projectOdometer(readings, monthlyEstimate, today);
    const rate = dailyRate(readings, monthlyEstimate, today);
    if (rate > 0) kmDate = addDays(today, kmLeft <= 0 ? Math.floor(kmLeft / rate) : Math.ceil(kmLeft / rate));
    else if (kmLeft <= 0) kmDate = today; // rate 0 and km still ahead: never reached, no date
  }

  // A tie goes to km: with the km already passed, the item is overdue even if the calendar says today.
  const dueBy = kmDate !== null && (timeDate === null || kmDate <= timeDate) ? 'km' : timeDate !== null ? 'time' : null;
  const dueDate = dueBy === 'km' ? kmDate : timeDate;
  const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
  return { dueDate, daysLeft, dueKm, kmLeft, dueBy, urgency: urgencyOf(daysLeft, kmLeft) };
}

const atMost = (v: number | null, limit: number) => v != null && v <= limit;

export function urgencyOf(daysLeft: number | null, kmLeft: number | null): Urgency {
  if (atMost(daysLeft, 15) || atMost(kmLeft, 500)) return 'critical';
  if (atMost(daysLeft, 45) || atMost(kmLeft, 1500)) return 'attention';
  return 'ok';
}
