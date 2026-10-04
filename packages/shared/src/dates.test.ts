import { describe, expect, it } from 'vitest';

import {
  addLocalDays,
  groupByLocalDay,
  lastLocalDayKeys,
  lastLocalDaysRange,
  localDayKey,
  localDayRange,
  parseLocalDayKey,
} from './dates.ts';

// These tests build dates with local-time constructors, so they hold in any TZ.
describe('local day helpers', () => {
  it('computes the local day range', () => {
    const { start, end } = localDayRange(new Date(2026, 9, 4, 23, 59));
    expect(start).toEqual(new Date(2026, 9, 4));
    expect(end).toEqual(new Date(2026, 9, 5));
  });

  it('formats and parses day keys', () => {
    expect(localDayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
    expect(parseLocalDayKey('2026-01-05')).toEqual(new Date(2026, 0, 5));
  });

  it('adds days across month and year boundaries', () => {
    expect(addLocalDays(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 1));
    expect(addLocalDays(new Date(2026, 2, 1), -1)).toEqual(new Date(2026, 1, 28));
  });

  it('builds the last N days range and keys', () => {
    const today = new Date(2026, 9, 4, 12);
    expect(lastLocalDaysRange(today, 7)).toEqual({
      start: new Date(2026, 8, 28),
      end: new Date(2026, 9, 5),
    });
    expect(lastLocalDayKeys(today, 3)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('groups records by local day, newest first', () => {
    const records = [
      { id: 1, at: new Date(2026, 9, 3, 8) },
      { id: 2, at: new Date(2026, 9, 4, 0, 5) },
      { id: 3, at: new Date(2026, 9, 3, 23, 55) },
    ];
    expect(groupByLocalDay(records, (r) => r.at)).toEqual([
      { day: '2026-10-04', records: [records[1]] },
      { day: '2026-10-03', records: [records[0], records[2]] },
    ]);
  });
});
