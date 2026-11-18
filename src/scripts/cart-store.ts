/**
 * Cart state. Framework-free on purpose: a tiny observable store whose
 * only side effect is persisting to localStorage.
 */
export type Fulfillment = 'retirada' | 'entrega';

export interface CartState {
  /** cart line key (menu id or `montado|…`) -> quantity (always >= 1; zero removes the line). */
  items: Record<string, number>;
  fulfillment: Fulfillment;
}

export const STORAGE_KEY = 'bendita:cart:v1';
export const MAX_QTY = 30;

type Listener = (state: CartState) => void;

const empty = (): CartState => ({ items: {}, fulfillment: 'retirada' });

/** Accepts only line keys that are still valid (menu ids or built sonhos) and sane quantities. */
export function sanitize(raw: unknown, isValid: (key: string) => boolean): CartState {
  const state = empty();
  if (!raw || typeof raw !== 'object') return state;
  const { items, fulfillment } = raw as Partial<CartState>;
  if (fulfillment === 'entrega') state.fulfillment = 'entrega';
  if (items && typeof items === 'object') {
    for (const [id, qty] of Object.entries(items)) {
      if (isValid(id) && Number.isInteger(qty) && qty > 0) {
        state.items[id] = Math.min(qty, MAX_QTY);
      }
    }
  }
  return state;
}

export function createCartStore(isValid: (key: string) => boolean) {
  let state = load();
  const listeners = new Set<Listener>();

  function load(): CartState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw), isValid) : empty();
    } catch {
      return empty();
    }
  }

  function commit(next: CartState) {
    state = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode or full storage: the cart still works for this visit */
    }
    listeners.forEach((fn) => fn(state));
  }

  function setQty(id: string, qty: number) {
    if (!isValid(id)) return;
    const items = { ...state.items };
    const clamped = Math.max(0, Math.min(MAX_QTY, Math.trunc(qty)));
    if (clamped === 0) delete items[id];
    else items[id] = clamped;
    commit({ ...state, items });
  }

  // Keep several open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = load();
    listeners.forEach((fn) => fn(state));
  });

  return {
    get: () => state,
    subscribe(fn: Listener) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    add: (id: string, by = 1) => setQty(id, (state.items[id] ?? 0) + by),
    setQty,
    remove: (id: string) => setQty(id, 0),
    setFulfillment: (fulfillment: Fulfillment) => commit({ ...state, fulfillment }),
    clear: () => commit({ ...empty(), fulfillment: state.fulfillment }),
  };
}

export type CartStore = ReturnType<typeof createCartStore>;
