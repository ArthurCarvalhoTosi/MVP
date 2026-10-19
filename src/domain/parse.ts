import type { ISODate } from './dates';

/** Whole number typed in pt-BR ("46250" or "46.250"); null when it isn't one. */
export function parseIntBR(s: string): number | null {
  const t = s.trim();
  if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(t)) return null;
  const n = Number(t.replace(/\./g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

/** Reais typed in pt-BR ("1.234,56", "150", "150,5") as cents; null when it isn't money. */
export function parseBRL(s: string): number | null {
  const t = s.trim();
  // Some Android number pads only offer ".", so a lone "." before 1-2 final digits is the decimal mark.
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t) ?? /^(\d+)\.(\d{1,2})$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1].replace(/\./g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Formats a date while it's typed: digits only, slashes added as each part starts ("1502" →
 * "15/02"). No trailing slash, so backspace over one never gets stuck re-adding it.
 */
export function maskBRDate(s: string): string {
  const d = s.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** "DD/MM/AAAA" (day and month may have one digit) up to `today`; null when impossible or in the future. */
export function parseBRDate(s: string, today: ISODate): ISODate | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Date rolls 31/02 into March (and years < 100 into 19xx); any mismatch means the date doesn't exist.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return iso <= today ? iso : null;
}
