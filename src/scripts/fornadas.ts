/**
 * "Sai do forno às…": the next batch of a product, in shop time (São Paulo).
 * Batches are whole hours. Mondays the shop is closed, so the next batch is on Tuesday.
 */

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function shopClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hourCycle: 'h23',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export interface NextBatch {
  hour: number;
  /** 0 = today, 1 = tomorrow, … */
  daysAhead: number;
  weekday: number;
}

/** Next batch strictly after now. Null when there are no batch hours. */
export function nextBatch(hours: number[], now: Date): NextBatch | null {
  if (hours.length === 0) return null;
  const sorted = [...hours].sort((a, b) => a - b);
  const { day, minutes } = shopClock(now);
  for (let ahead = 0; ahead < 8; ahead++) {
    const weekday = (day + ahead) % 7;
    if (weekday === 1) continue; // closed on Mondays
    const hour = sorted.find((h) => ahead > 0 || h * 60 > minutes);
    if (hour !== undefined) return { hour, daysAhead: ahead, weekday };
  }
  return null;
}

/** "Sai do forno às 15h", "Próxima fornada amanhã às 8h", "Próxima fornada terça às 8h". */
export function batchLabel(next: NextBatch | null): string {
  if (!next) return '';
  if (next.daysAhead === 0) return `Sai do forno às ${next.hour}h`;
  const when = next.daysAhead === 1 ? 'amanhã' : WEEKDAYS[next.weekday];
  return `Próxima fornada ${when} às ${next.hour}h`;
}
