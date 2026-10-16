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
  urgency: Urgency;
}

export function computeDue(
  item: ItemSchedule,
  readings: OdometerReading[],
  monthlyEstimate: number,
  today: ISODate,
): Due {
  const dates: ISODate[] = [];
  if (item.intervalMonths != null) dates.push(addMonths(item.baselineDate, item.intervalMonths));

  let dueKm: number | null = null;
  let kmLeft: number | null = null;
  if (item.intervalKm != null) {
    dueKm = item.baselineKm + item.intervalKm;
    kmLeft = dueKm - projectOdometer(readings, monthlyEstimate, today);
    const rate = dailyRate(readings, monthlyEstimate, today);
    if (rate > 0) dates.push(addDays(today, kmLeft <= 0 ? Math.floor(kmLeft / rate) : Math.ceil(kmLeft / rate)));
    else if (kmLeft <= 0) dates.push(today); // rate 0 and km still ahead: never reached, no date
  }

  const dueDate = dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
  const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
  return { dueDate, daysLeft, dueKm, kmLeft, urgency: urgencyOf(daysLeft, kmLeft) };
}

const atMost = (v: number | null, limit: number) => v != null && v <= limit;

export function urgencyOf(daysLeft: number | null, kmLeft: number | null): Urgency {
  if (atMost(daysLeft, 15) || atMost(kmLeft, 500)) return 'critical';
  if (atMost(daysLeft, 45) || atMost(kmLeft, 1500)) return 'attention';
  return 'ok';
}
