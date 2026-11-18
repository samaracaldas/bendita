interface ImportMetaEnv {
  /** Supabase project URL. Without it the shop runs in demo mode (nothing leaves the browser). */
  readonly PUBLIC_SUPABASE_URL?: string;
  /** Supabase anon (public) key. Safe to ship: RLS decides what it can do. */
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  /**
   * Public read-only account for the counter panel (papel 'visitante' in equipe).
   * Shipped in the page on purpose so anyone can look around; the database blocks every change.
   */
  readonly PUBLIC_BALCAO_VISITANTE_EMAIL?: string;
  readonly PUBLIC_BALCAO_VISITANTE_SENHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
