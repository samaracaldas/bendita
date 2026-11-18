/** Opening hours by weekday (0 = domingo). null = fechado. */
const HOURS: ([open: number, close: number] | null)[] = [
  [7, 21], // domingo
  null, // segunda
  [7, 20],
  [7, 20],
  [7, 20],
  [7, 20],
  [7, 21], // sábado
];

const STEP_MIN = 30;
/** Orders need at least this much time to be packed. */
const LEAD_MIN = 30;

export interface Slot {
  value: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Pickup/delivery slots for the next two open days, every 30 minutes,
 * starting at least 30 minutes from `now` and ending at closing time.
 */
export function getSlots(now: Date, daysWanted = 2): Slot[] {
  const slots: Slot[] = [];
  const earliest = now.getTime() + LEAD_MIN * 60_000;
  let found = 0;

  for (let offset = 0; offset < 8 && found < daysWanted; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const hours = HOURS[day.getDay()];
    if (!hours) continue;

    const daySlots: Slot[] = [];
    for (let m = hours[0] * 60 + STEP_MIN; m <= hours[1] * 60; m += STEP_MIN) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
      if (t.getTime() < earliest) continue;
      const dayName = offset === 0 ? 'Hoje' : offset === 1 ? 'Amanhã' : WEEKDAYS[t.getDay()];
      const time = `${t.getHours()}h${t.getMinutes() ? pad(t.getMinutes()) : ''}`;
      daySlots.push({
        value: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`,
        label: `${dayName[0].toUpperCase()}${dayName.slice(1)}, ${time}`,
      });
    }
    if (daySlots.length) {
      slots.push(...daySlots);
      found++;
    }
  }
  return slots;
}
