import { describe, expect, it } from 'vitest';
import { batchLabel, nextBatch } from './fornadas';

// 17/11/2026 is a Tuesday. Times are São Paulo (UTC−3).
const at = (iso: string) => new Date(iso);
const hourly = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

describe('nextBatch', () => {
  it('picks the next hour today', () => {
    expect(batchLabel(nextBatch(hourly, at('2026-11-17T14:20:00-03:00')))).toBe('Sai do forno às 15h');
  });

  it('a batch on the hour has already come out', () => {
    expect(batchLabel(nextBatch([7, 10, 15], at('2026-11-17T10:00:00-03:00')))).toBe('Sai do forno às 15h');
  });

  it('after the last batch, it is tomorrow', () => {
    expect(batchLabel(nextBatch([7, 16], at('2026-11-17T18:00:00-03:00')))).toBe('Próxima fornada amanhã às 7h');
  });

  it('skips Monday, when the shop is closed', () => {
    // Sunday 22/11 at 20h: Monday is closed, so Tuesday.
    expect(batchLabel(nextBatch(hourly, at('2026-11-22T20:00:00-03:00')))).toBe('Próxima fornada terça às 8h');
    // Monday itself.
    expect(batchLabel(nextBatch(hourly, at('2026-11-23T09:00:00-03:00')))).toBe('Próxima fornada amanhã às 8h');
  });

  it('uses shop time whatever the visitor time zone', () => {
    // 01:30 UTC on the 18th is still 22:30 on the 17th in São Paulo.
    expect(nextBatch([8], at('2026-11-18T01:30:00Z'))).toMatchObject({ hour: 8, daysAhead: 1 });
  });

  it('has nothing to say without batch hours', () => {
    expect(batchLabel(nextBatch([], new Date()))).toBe('');
  });
});
