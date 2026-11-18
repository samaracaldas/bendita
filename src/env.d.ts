interface ImportMetaEnv {
  /** Supabase project URL. Without it the shop runs in demo mode (nothing leaves the browser). */
  readonly PUBLIC_SUPABASE_URL?: string;
  /** Supabase anon (public) key. Safe to ship: RLS decides what it can do. */
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
