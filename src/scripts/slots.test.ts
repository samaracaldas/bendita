import { describe, expect, it } from 'vitest';
import { getSlots } from './slots';

// Months are 0-based: new Date(2026, 10, 17) is Tuesday, 17 November 2026.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const labels = (now: Date) => getSlots(now).map((s) => s.label);

describe('getSlots', () => {
  it('starts at least 30 minutes from now, every 30 minutes', () => {
    const slots = labels(at(17, 12, 10)); // Tuesday 12h10
    expect(slots.slice(0, 3)).toEqual(['Hoje, 13h', 'Hoje, 13h30', 'Hoje, 14h']);
  });

  it('accepts a slot exactly 30 minutes ahead', () => {
    expect(labels(at(17, 12, 30))[0]).toBe('Hoje, 13h');
    expect(labels(at(17, 12, 0))[0]).toBe('Hoje, 12h30');
  });

  it('ends today at closing time and continues tomorrow', () => {
    const slots = labels(at(17, 18, 0)); // Tuesday, closes 20h
    expect(slots).toContain('Hoje, 20h');
    expect(slots).not.toContain('Hoje, 20h30');
    expect(slots).toContain('Amanhã, 7h30');
  });

  it('jumps to the next day once the shop is closed', () => {
    expect(labels(at(17, 21, 0))[0]).toBe('Amanhã, 7h30');
  });

  it('skips Monday, when the shop is closed', () => {
    // Sunday 22 November, after closing: Monday is skipped, Tuesday comes next.
    const slots = getSlots(at(22, 22, 0));
    expect(slots[0].label).toBe('Terça, 7h30');
    expect(slots.every((s) => !s.value.startsWith('2026-11-23'))).toBe(true);
  });

  it('keeps weekends open until 21h', () => {
    expect(labels(at(21, 19, 0))).toContain('Hoje, 21h'); // Saturday
  });

  it('covers exactly two open days', () => {
    const days = new Set(getSlots(at(17, 8, 0)).map((s) => s.value.slice(0, 10)));
    expect([...days]).toEqual(['2026-11-17', '2026-11-18']);
  });

  it('uses ISO-like values that sort chronologically', () => {
    const values = getSlots(at(17, 8, 0)).map((s) => s.value);
    expect(values).toEqual([...values].sort());
    expect(values[0]).toBe('2026-11-17T08:30');
  });
});
