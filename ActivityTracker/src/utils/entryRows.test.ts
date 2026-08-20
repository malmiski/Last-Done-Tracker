import { buildEntryRows } from './entryRows';

const entry = (id: string, iso: string) =>
  ({
    id,
    activityId: 'a1',
    startDate: new Date(iso),
    endDate: new Date(iso),
  }) as any;

describe('buildEntryRows', () => {
  it('numbers the oldest entry 1 and the newest highest', () => {
    // Newest first, which is the order the list receives.
    const entries = [
      entry('c', '2026-03-01T10:00:00Z'),
      entry('b', '2026-02-01T10:00:00Z'),
      entry('a', '2026-01-01T10:00:00Z'),
    ];

    expect(buildEntryRows(entries, 3).map(row => row.displayIndex)).toEqual([3, 2, 1]);
  });

  it('numbers a first page against the full count, not the page length', () => {
    // Only 30 of 500 rows are loaded; the newest is still #500.
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry(`e${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );

    const rows = buildEntryRows(entries, 500);
    expect(rows[0].displayIndex).toBe(500);
    expect(rows[29].displayIndex).toBe(471);
  });

  it('never produces a number below 1 when the count has not arrived yet', () => {
    const entries = [entry('b', '2026-02-01T10:00:00Z'), entry('a', '2026-01-01T10:00:00Z')];

    // total still 0 on the very first render.
    expect(buildEntryRows(entries, 0).map(row => row.displayIndex)).toEqual([2, 1]);
  });

  it('renumbers by itself when an entry is removed', () => {
    const entries = [
      entry('c', '2026-03-01T10:00:00Z'),
      entry('b', '2026-02-01T10:00:00Z'),
      entry('a', '2026-01-01T10:00:00Z'),
    ];

    const afterDelete = buildEntryRows([entries[0], entries[2]], 2);
    expect(afterDelete.map(row => row.displayIndex)).toEqual([2, 1]);
    // Nothing is stored, so the surviving oldest entry simply becomes 1.
    expect(afterDelete[1].entry.id).toBe('a');
  });

  it('hands each row the end time of the entry before it', () => {
    const entries = [
      entry('c', '2026-03-01T10:00:00Z'),
      entry('b', '2026-02-01T10:00:00Z'),
      entry('a', '2026-01-01T10:00:00Z'),
    ];

    const rows = buildEntryRows(entries, 3);
    expect(rows[0].previousEndDate).toEqual(new Date('2026-02-01T10:00:00Z'));
    expect(rows[1].previousEndDate).toEqual(new Date('2026-01-01T10:00:00Z'));
    // The oldest loaded row has nothing before it.
    expect(rows[2].previousEndDate).toBeUndefined();
  });

  it('returns nothing for an empty list', () => {
    expect(buildEntryRows([], 0)).toEqual([]);
    expect(buildEntryRows([], 12)).toEqual([]);
  });
});
