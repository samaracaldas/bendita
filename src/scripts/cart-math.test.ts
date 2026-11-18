import { describe, expect, it } from 'vitest';
import { resolveLine } from '../data/catalog';
import { COMBO_DISCOUNT, DELIVERY_FEE, MENU, formatBRL } from '../data/menu';
import { PHOTOS } from '../data/photos';
import { cartTotals, pickupOnlyLines } from './cart-math';

const byId = resolveLine;

describe('cartTotals', () => {
  it('sums units and prices in centavos', () => {
    // 3 × R$ 8,50 + 1 × R$ 12,00
    const t = cartTotals({ items: { 'sonho-creme': 3, 'pao-de-queijo': 1 }, fulfillment: 'retirada' }, byId);
    expect(t).toEqual({ count: 4, subtotal: 3750, combos: 0, discount: 0, fee: 0, total: 3750 });
  });

  it('adds the delivery fee only when delivering', () => {
    const t = cartTotals({ items: { 'sonho-creme': 3 }, fulfillment: 'entrega' }, byId);
    expect(t.fee).toBe(DELIVERY_FEE);
    expect(t.total).toBe(2550 + DELIVERY_FEE);
    expect(formatBRL(t.total).replace(/\s/g, ' ')).toBe('R$ 32,50');
  });

  it('does not charge delivery on an empty bag', () => {
    expect(cartTotals({ items: {}, fulfillment: 'entrega' }, byId)).toEqual({
      count: 0,
      subtotal: 0,
      combos: 0,
      discount: 0,
      fee: 0,
      total: 0,
    });
  });

  it('ignores products that are no longer on the menu', () => {
    const t = cartTotals({ items: { 'pote-cenoura': 2, coxinha: 1 }, fulfillment: 'retirada' }, byId);
    expect(t).toMatchObject({ count: 1, subtotal: 800 });
  });

  it('takes the combo discount once per sonho + café pair', () => {
    // 3 sonhos (one built) and 2 coffees: 2 pairs. The iced chocolate is not a coffee.
    const t = cartTotals(
      {
        items: {
          'sonho-creme': 2,
          'montado|tradicional|creme|acucar': 1,
          'cafe-coado': 1,
          cappuccino: 1,
          'achocolatado-gelado': 3,
        },
        fulfillment: 'retirada',
      },
      byId,
    );
    expect(t.combos).toBe(2);
    expect(t.discount).toBe(2 * COMBO_DISCOUNT);
    expect(t.total).toBe(t.subtotal - 2 * COMBO_DISCOUNT);
  });
});

describe('pickupOnlyLines', () => {
  it('lists the drinks in the bag', () => {
    const lines = pickupOnlyLines(
      { items: { coxinha: 1, pingado: 2, 'achocolatado-gelado': 1 }, fulfillment: 'entrega' },
      byId,
    );
    expect(lines.map((l) => l.productId)).toEqual(['pingado', 'achocolatado-gelado']);
  });
});

describe('menu', () => {
  it('has unique ids and whole-centavo prices', () => {
    expect(new Set(MENU.map((p) => p.id)).size).toBe(MENU.length);
    for (const p of MENU) expect(Number.isInteger(p.price) && p.price > 0).toBe(true);
  });

  it('has a photo for every product', () => {
    expect(MENU.filter((p) => !PHOTOS[p.id]).map((p) => p.id)).toEqual([]);
  });

  it('only drinks are pickup only', () => {
    for (const p of MENU) expect(p.pickupOnly ?? false).toBe(p.category === 'bebidas');
  });
});
