import { COMBO_DISCOUNT, DELIVERY_FEE, type ComboRole } from '../data/menu';
import type { CartState } from './cart-store';

export interface CartTotals {
  /** Number of units in the bag (not distinct lines). */
  count: number;
  subtotal: number;
  /** Sonho + café pairs in the bag; each takes COMBO_DISCOUNT off. */
  combos: number;
  discount: number;
  fee: number;
  total: number;
}

type PriceOf = (key: string) => { price: number; combo?: ComboRole } | null;

/**
 * All values in centavos. Unknown lines are ignored; delivery is free on an empty bag.
 * Same rules as criar_pedido in the database (a test checks both agree).
 */
export function cartTotals(state: CartState, resolve: PriceOf): CartTotals {
  let count = 0;
  let subtotal = 0;
  let sonhos = 0;
  let cafes = 0;
  for (const [key, qty] of Object.entries(state.items)) {
    const line = resolve(key);
    if (!line) continue;
    count += qty;
    subtotal += line.price * qty;
    if (line.combo === 'sonho') sonhos += qty;
    if (line.combo === 'cafe') cafes += qty;
  }
  const combos = Math.min(sonhos, cafes);
  const discount = combos * COMBO_DISCOUNT;
  const fee = count > 0 && state.fulfillment === 'entrega' ? DELIVERY_FEE : 0;
  return { count, subtotal, combos, discount, fee, total: subtotal - discount + fee };
}

/** Lines that can't go out for delivery (drinks). */
export function pickupOnlyLines<T extends { pickupOnly: boolean }>(state: CartState, resolve: (key: string) => T | null) {
  return Object.keys(state.items)
    .map(resolve)
    .filter((l): l is T => l !== null && l.pickupOnly);
}

/** Units per product id: what checking stock needs (several sonho lines share one product). */
export function unitsByProduct(state: CartState, resolve: (key: string) => { productId: string } | null) {
  const units = new Map<string, number>();
  for (const [key, qty] of Object.entries(state.items)) {
    const line = resolve(key);
    if (line) units.set(line.productId, (units.get(line.productId) ?? 0) + qty);
  }
  return units;
}
