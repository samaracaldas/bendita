import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dirname, '..', 'migrations');

/**
 * What a Supabase project provides before our migrations run: the API roles,
 * auth.users / auth.uid() and the realtime publication.
 */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create publication supabase_realtime;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  return db;
}

export type Db = Awaited<ReturnType<typeof createDb>>;

/** Runs `fn` as an API role, the way PostgREST does for each request. */
export async function as<T>(db: Db, role: 'anon' | 'authenticated', userId: string | null, fn: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Next valid slot: tomorrow (or the next open day) at 10h30 in São Paulo. */
export function nextSlot(daysAhead = 1): string {
  const now = new Date();
  for (let d = daysAhead; d < daysAhead + 7; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(day);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(day);
    if (weekday !== 'Mon') return `${ymd}T10:30:00-03:00`;
  }
  throw new Error('no slot');
}
