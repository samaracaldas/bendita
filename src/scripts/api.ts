/**
 * The public shop's only contact with Supabase: two RPCs over plain fetch
 * (PostgREST), so supabase-js stays out of the landing page bundle.
 */

const URL = import.meta.env.PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/** False in demo mode: no backend configured, orders are simulated in the browser. */
export const online = Boolean(URL && KEY);

export type OrderErrorKind = 'esgotado' | 'horario' | 'dados' | 'item' | 'limite' | 'retirada' | 'rede';

export class OrderError extends Error {
  constructor(
    readonly kind: OrderErrorKind,
    /** esgotado: product id; dados: field; item: line key; limite: 'origem' | 'geral' | 'unidades'. */
    readonly ref?: string,
    /** esgotado: units still available that day; limite 'unidades': most units per order. */
    readonly restantes?: number,
  ) {
    super(kind);
  }
}

export interface OrderInput {
  nome: string;
  tipo: 'retirada' | 'entrega';
  endereco: string | null;
  /** ISO timestamp with offset, e.g. 2026-11-18T10:30:00-03:00 */
  horario: string;
  obs: string | null;
  itens: { linha: string; quantidade: number }[];
}

export interface OrderResult {
  codigo: string;
  /** Secret for the tracking page. Absent in demo mode. */
  token?: string;
  subtotal: number;
  /** Sonho + café combo discount. */
  desconto?: number;
  taxa: number;
  total: number;
}

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: KEY!,
        // Legacy anon keys are JWTs and also go in Authorization; new sb_publishable_ keys must not.
        ...(KEY!.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OrderError('rede');
  }
  if (res.ok) return res.json() as Promise<T>;

  const err = (await res.json().catch(() => ({}))) as { message?: string; hint?: string; details?: string };
  switch (err.message) {
    case 'esgotado':
      throw new OrderError('esgotado', err.hint, Number(err.details ?? 0));
    case 'horario_invalido':
      throw new OrderError('horario');
    case 'dados_invalidos':
      throw new OrderError('dados', err.hint);
    case 'item_invalido':
      throw new OrderError('item', err.hint);
    case 'so_retirada':
      throw new OrderError('retirada', err.hint);
    case 'limite':
      throw new OrderError('limite', err.hint, err.details ? Number(err.details) : undefined);
    default:
      throw new OrderError('rede');
  }
}

/** Units left per product for a day (YYYY-MM-DD, São Paulo). Null in demo mode or on failure. */
export async function fetchStock(dia: string): Promise<Map<string, number> | null> {
  if (!online) return null;
  try {
    const rows = await rpc<{ produto_id: string; restantes: number }[]>('estoque_do_dia', { p_dia: dia });
    return new Map(rows.map((r) => [r.produto_id, Math.max(0, r.restantes)]));
  } catch {
    return null;
  }
}

export interface PartyOrderInput {
  nome: string;
  telefone: string;
  /** YYYY-MM-DD */
  data: string;
  periodo: 'manha' | 'tarde';
  tipo: 'retirada' | 'entrega';
  endereco: string | null;
  obs: string | null;
  itens: { kit: string; quantidade: number; sabores: string[] }[];
}

export interface PartyOrderResult {
  codigo: string;
  subtotal: number;
  taxa: number;
  total: number;
}

/** Party order (by the hundred). Errors come as OrderError: dados (hint = field), item (hint = kit), limite. */
export async function placePartyOrder(
  input: PartyOrderInput,
  demoTotals: Omit<PartyOrderResult, 'codigo'>,
): Promise<PartyOrderResult> {
  if (!online) {
    await new Promise((r) => setTimeout(r, 400));
    return { codigo: `F-${Math.floor(1000 + Math.random() * 9000)}`, ...demoTotals };
  }
  return rpc<PartyOrderResult>('criar_encomenda', {
    p_nome: input.nome,
    p_telefone: input.telefone,
    p_data: input.data,
    p_periodo: input.periodo,
    p_tipo: input.tipo,
    p_endereco: input.endereco,
    p_obs: input.obs,
    p_itens: input.itens,
  });
}

export async function placeOrder(input: OrderInput, demoTotals: Omit<OrderResult, 'codigo'>): Promise<OrderResult> {
  if (!online) {
    await new Promise((r) => setTimeout(r, 400));
    return { codigo: `B-${Math.floor(1000 + Math.random() * 9000)}`, ...demoTotals };
  }
  return rpc<OrderResult>('criar_pedido', {
    p_nome: input.nome,
    p_tipo: input.tipo,
    p_endereco: input.endereco,
    p_horario: input.horario,
    p_obs: input.obs,
    p_itens: input.itens,
  });
}

export type OrderStatus = 'recebido' | 'separado' | 'pronto' | 'entregue' | 'cancelado';

export interface TrackedOrder {
  codigo: string;
  /** First name only. */
  nome: string;
  tipo: 'retirada' | 'entrega';
  horario: string;
  status: OrderStatus;
  subtotal: number;
  desconto: number;
  taxa: number;
  total: number;
  atualizado_em: string;
  itens: { descricao: string; quantidade: number }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An order by its tracking token. Null when the token is unknown; throws OrderError('rede') when offline. */
export async function trackOrder(token: string): Promise<TrackedOrder | null> {
  if (!online || !UUID.test(token)) return null;
  return rpc<TrackedOrder | null>('acompanhar_pedido', { p_token: token });
}

const LAST_ORDER_KEY = 'bendita:ultimo-pedido:v1';

/** Remembers the last order on this device so the shop can link back to it. */
export function rememberOrder(order: { codigo: string; token: string }) {
  try {
    localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ ...order, em: Date.now() }));
  } catch {
    // Private mode or storage full: the link in the confirmation still works.
  }
}

/** The last order placed on this device in the past 2 days, if any. */
export function lastOrder(): { codigo: string; token: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) ?? 'null');
    if (raw && typeof raw.codigo === 'string' && UUID.test(raw.token) && Date.now() - raw.em < 2 * 86_400_000) {
      return { codigo: raw.codigo, token: raw.token };
    }
  } catch {
    // Ignore unreadable storage.
  }
  return null;
}

export const trackUrl = (token: string) => `/pedido?t=${encodeURIComponent(token)}`;

/** Today in São Paulo as YYYY-MM-DD. */
export const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
