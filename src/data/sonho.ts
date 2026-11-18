/**
 * "Monte o seu sonho": options, prices and the cart-line key that encodes a choice.
 * The same rules live in the database (supabase/migrations), which recomputes the
 * price on checkout; keep both in sync. A unit test checks the seed SQL against this file.
 */

export type Grupo = 'massa' | 'recheio' | 'cobertura';

export interface Opcao {
  id: string;
  grupo: Grupo;
  nome: string;
  /** Extra price in centavos. */
  acrescimo: number;
  /** Illustration color. */
  cor: string;
}

export const SONHO_BASE = 900;
export const MEIO_A_MEIO = 100;
export const SONHO_MONTADO_ID = 'sonho-montado';

export const OPCOES: Opcao[] = [
  { id: 'tradicional', grupo: 'massa', nome: 'Tradicional', acrescimo: 0, cor: '#eaa65b' },
  { id: 'brioche', grupo: 'massa', nome: 'Brioche', acrescimo: 100, cor: '#d98a3d' },

  { id: 'doce-de-leite', grupo: 'recheio', nome: 'Doce de leite', acrescimo: 0, cor: '#b8732e' },
  { id: 'creme', grupo: 'recheio', nome: 'Creme', acrescimo: 0, cor: '#ffd23f' },
  { id: 'brigadeiro', grupo: 'recheio', nome: 'Brigadeiro', acrescimo: 0, cor: '#5a2e22' },
  { id: 'goiabada', grupo: 'recheio', nome: 'Goiabada', acrescimo: 0, cor: '#d9465f' },
  { id: 'avela', grupo: 'recheio', nome: 'Creme de avelã', acrescimo: 200, cor: '#7a4a2a' },
  { id: 'frutas-vermelhas', grupo: 'recheio', nome: 'Frutas vermelhas', acrescimo: 150, cor: '#a3243b' },

  { id: 'acucar', grupo: 'cobertura', nome: 'Açúcar', acrescimo: 0, cor: '#fff4ec' },
  { id: 'canela', grupo: 'cobertura', nome: 'Açúcar e canela', acrescimo: 0, cor: '#a0622d' },
  { id: 'granulado', grupo: 'cobertura', nome: 'Granulado', acrescimo: 50, cor: '#3a1d17' },
  { id: 'sem', grupo: 'cobertura', nome: 'Sem cobertura', acrescimo: 0, cor: 'transparent' },
];

const byId = new Map(OPCOES.map((o) => [o.id, o]));
export const opcao = (id: string) => byId.get(id);
export const opcoesDo = (grupo: Grupo) => OPCOES.filter((o) => o.grupo === grupo);

export interface SonhoConfig {
  massa: string;
  /** One or two fillings ("meio a meio"). */
  recheios: [string] | [string, string];
  cobertura: string;
}

export const SONHO_PADRAO: SonhoConfig = { massa: 'tradicional', recheios: ['doce-de-leite'], cobertura: 'acucar' };

const PREFIX = 'montado|';

/** Cart line key, e.g. `montado|brioche|creme+goiabada|canela`. Fillings are sorted so equal sonhos share a line. */
export function sonhoKey(c: SonhoConfig): string {
  const recheios = [...new Set(c.recheios)].sort();
  return `${PREFIX}${c.massa}|${recheios.join('+')}|${c.cobertura}`;
}

const inGroup = (id: string, grupo: Grupo) => byId.get(id)?.grupo === grupo;

/** Parses and validates a line key. Returns null for anything that is not a valid sonho. */
export function parseSonhoKey(key: string): SonhoConfig | null {
  if (!key.startsWith(PREFIX)) return null;
  const parts = key.slice(PREFIX.length).split('|');
  if (parts.length !== 3) return null;
  const [massa, recheiosRaw, cobertura] = parts;
  const recheios = recheiosRaw.split('+');
  if (!inGroup(massa, 'massa') || !inGroup(cobertura, 'cobertura')) return null;
  if (recheios.length < 1 || recheios.length > 2 || new Set(recheios).size !== recheios.length) return null;
  if (!recheios.every((r) => inGroup(r, 'recheio'))) return null;
  // Only the canonical (sorted) spelling is valid, so one sonho never has two keys.
  if (recheios.join('+') !== [...recheios].sort().join('+')) return null;
  return { massa, recheios: recheios as SonhoConfig['recheios'], cobertura };
}

export function sonhoPreco(c: SonhoConfig): number {
  const extras = [c.massa, ...c.recheios, c.cobertura].reduce((sum, id) => sum + (byId.get(id)?.acrescimo ?? 0), 0);
  return SONHO_BASE + extras + (c.recheios.length === 2 ? MEIO_A_MEIO : 0);
}

export function sonhoDescricao(c: SonhoConfig): string {
  const recheio = c.recheios.map((r) => byId.get(r)!.nome.toLowerCase()).join(' e ');
  const massa = c.massa === 'brioche' ? 'massa brioche' : 'massa tradicional';
  const cobertura = c.cobertura === 'sem' ? 'sem cobertura' : `cobertura de ${byId.get(c.cobertura)!.nome.toLowerCase()}`;
  return `${c.recheios.length === 2 ? 'Meio a meio: ' : ''}${recheio}, ${massa}, ${cobertura}`;
}
