import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_QTY, STORAGE_KEY, createCartStore, sanitize } from './cart-store';

const known = new Set(['sonho-creme', 'coxinha', 'pao-de-queijo']);
const ids = (key: string) => known.has(key);
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

beforeEach(() => localStorage.clear());

describe('sanitize', () => {
  it('returns an empty pickup bag for anything that is not an object', () => {
    for (const raw of [null, undefined, 42, 'sacola', []]) {
      expect(sanitize(raw, ids)).toEqual({ items: {}, fulfillment: 'retirada' });
    }
  });

  it('drops products that left the menu and quantities that make no sense', () => {
    const state = sanitize(
      {
        items: { 'sonho-creme': 2, 'pote-cenoura': 3, coxinha: -1, 'pao-de-queijo': 1.5 },
        fulfillment: 'entrega',
      },
      ids,
    );
    expect(state).toEqual({ items: { 'sonho-creme': 2 }, fulfillment: 'entrega' });
  });

  it('caps quantities at the maximum', () => {
    expect(sanitize({ items: { coxinha: 999 } }, ids).items.coxinha).toBe(MAX_QTY);
  });

  it('falls back to pickup for an unknown fulfillment', () => {
    expect(sanitize({ items: {}, fulfillment: 'drone' }, ids).fulfillment).toBe('retirada');
  });
});

describe('createCartStore', () => {
  it('adds, changes and removes items, saving every change', () => {
    const cart = createCartStore(ids);
    cart.add('sonho-creme');
    cart.add('sonho-creme', 2);
    cart.add('coxinha');
    expect(saved().items).toEqual({ 'sonho-creme': 3, coxinha: 1 });

    cart.setQty('sonho-creme', 1);
    cart.remove('coxinha');
    expect(cart.get().items).toEqual({ 'sonho-creme': 1 });
    expect(saved().items).toEqual({ 'sonho-creme': 1 });
  });

  it('removes a line when its quantity reaches zero', () => {
    const cart = createCartStore(ids);
    cart.add('coxinha');
    cart.setQty('coxinha', 0);
    expect(cart.get().items).toEqual({});
  });

  it('clamps quantities between 0 and the maximum', () => {
    const cart = createCartStore(ids);
    cart.setQty('coxinha', MAX_QTY + 10);
    expect(cart.get().items.coxinha).toBe(MAX_QTY);
    cart.add('coxinha');
    expect(cart.get().items.coxinha).toBe(MAX_QTY);
    cart.setQty('coxinha', -5);
    expect(cart.get().items).toEqual({});
  });

  it('ignores products that are not on the menu', () => {
    const cart = createCartStore(ids);
    cart.add('bolo-de-festa');
    expect(cart.get().items).toEqual({});
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('restores the bag saved by a previous visit', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: { coxinha: 4 }, fulfillment: 'entrega' }));
    expect(createCartStore(ids).get()).toEqual({ items: { coxinha: 4 }, fulfillment: 'entrega' });
  });

  it('starts empty when the saved bag is corrupted', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(createCartStore(ids).get()).toEqual({ items: {}, fulfillment: 'retirada' });
  });

  it('keeps working in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const cart = createCartStore(ids);
    cart.add('coxinha', 2);
    expect(cart.get().items).toEqual({ coxinha: 2 });
  });

  it('keeps the chosen fulfillment when the bag is emptied', () => {
    const cart = createCartStore(ids);
    cart.setFulfillment('entrega');
    cart.add('coxinha');
    cart.clear();
    expect(cart.get()).toEqual({ items: {}, fulfillment: 'entrega' });
  });

  it('notifies subscribers right away and on every change', () => {
    const cart = createCartStore(ids);
    const listener = vi.fn();
    cart.subscribe(listener);
    cart.add('coxinha');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ items: { coxinha: 1 }, fulfillment: 'retirada' });
  });

  it('picks up changes made in another tab', () => {
    const cart = createCartStore(ids);
    const listener = vi.fn();
    cart.subscribe(listener);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: { 'pao-de-queijo': 2 }, fulfillment: 'retirada' }));
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(cart.get().items).toEqual({ 'pao-de-queijo': 2 });
    expect(listener).toHaveBeenLastCalledWith(cart.get());
  });
});
