/**
 * Local-day helpers. All functions use the runtime's local timezone (the device's on mobile),
 * which is the user's timezone. The `daily_totals` view buckets by UTC, so the app queries
 * `meals.eaten_at` with these boundaries instead.
 */

export interface DayRange {
  /** Local midnight at the start of the first day (inclusive). */
  start: Date;
  /** Local midnight after the last day (exclusive). */
  end: Date;
}

/** Local midnight at the start of the day containing `date`. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Adds whole calendar days in local time (safe across DST changes). */
export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The local day containing `date`, as a half-open [start, end) range. */
export function localDayRange(date: Date): DayRange {
  const start = startOfLocalDay(date);
  return { start, end: addLocalDays(start, 1) };
}

/** The last `days` local days, ending with (and including) the day containing `today`. */
export function lastLocalDaysRange(today: Date, days: number): DayRange {
  const end = addLocalDays(startOfLocalDay(today), 1);
  return { start: addLocalDays(end, -Math.max(1, days)), end };
}

/** 'YYYY-MM-DD' for the local day containing `date`. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day keys for the last `days` local days, oldest first, ending with `today`. */
export function lastLocalDayKeys(today: Date, days: number): string[] {
  const start = startOfLocalDay(today);
  return Array.from({ length: days }, (_, i) => localDayKey(addLocalDays(start, i - days + 1)));
}

/** Groups records by the local day of `getDate(record)`, newest day first. */
export function groupByLocalDay<T>(
  records: readonly T[],
  getDate: (record: T) => Date,
): { day: string; records: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of records) {
    const key = localDayKey(getDate(r));
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, recs]) => ({ day, records: recs }));
}

/** Parses a 'YYYY-MM-DD' key as local midnight. */
export function parseLocalDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
