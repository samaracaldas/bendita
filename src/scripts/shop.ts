/**
 * Shared state for the page: the bag, today's stock and the small feedback
 * pieces (announcer, toast, fly-to-bag) used by the vitrine, the montador and the bag.
 */
import { resolveLine } from '../data/catalog';
import { fetchStock, hojeSP } from './api';
import { unitsByProduct } from './cart-math';
import { MAX_QTY, createCartStore } from './cart-store';

export const cart = createCartStore((key) => resolveLine(key) !== null);

/* ---------- Stock ---------- */
type StockListener = () => void;
let stock: Map<string, number> | null = null;
const stockListeners = new Set<StockListener>();

export const onStock = (fn: StockListener) => {
  stockListeners.add(fn);
  fn();
};

export async function refreshStock() {
  stock = await fetchStock(hojeSP());
  stockListeners.forEach((fn) => fn());
}

/** Units of a product still available today (Infinity when there is no stock information). */
export const remaining = (productId: string) => stock?.get(productId) ?? Infinity;

/** Units of a product already in the bag. */
export const inBag = (productId: string) => unitsByProduct(cart.get(), resolveLine).get(productId) ?? 0;

/** How many more units of this line can go in the bag. */
export function room(key: string) {
  const line = resolveLine(key);
  if (!line) return 0;
  const qty = cart.get().items[key] ?? 0;
  return Math.max(0, Math.min(MAX_QTY - qty, remaining(line.productId) - inBag(line.productId)));
}

/* ---------- Feedback ---------- */
const announcer = document.querySelector<HTMLElement>('[data-announcer]')!;
const toast = document.querySelector<HTMLElement>('[data-toast]')!;
const dialog = document.querySelector<HTMLDialogElement>('#sacola')!;
let toastTimer: number | undefined;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function announce(message: string, showToast = false) {
  announcer.textContent = '';
  // Next frame so screen readers notice a repeated message.
  requestAnimationFrame(() => (announcer.textContent = message));
  if (showToast && !dialog.open) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 2600);
  }
}

export const hideToast = () => (toast.hidden = true);

const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
/** While something is flying to the bag, the badge waits to bump until it lands. */
export let flying = 0;

export function bumpBadge() {
  const badge = document.querySelector<HTMLElement>('[data-cart-count]')!;
  badge.classList.remove('bump');
  void badge.offsetWidth; // restart the animation
  badge.classList.add('bump');
}

/** Sends a copy of an illustration to the bag button. */
function flyToBag(art: SVGElement | null) {
  const bag = document.querySelector<HTMLElement>('[data-cart-count]')!;
  if (calm.matches || !art || !bag.getClientRects().length) return;

  const a = art.getBoundingClientRect();
  const b = bag.getBoundingClientRect();
  const size = 64;
  const clone = art.cloneNode(true) as SVGElement;
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${a.left + a.width / 2 - size / 2}px`,
    top: `${a.top + a.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    zIndex: '40',
    pointerEvents: 'none',
  });
  document.body.append(clone);

  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  flying++;
  const anim = clone.animate(
    [
      { transform: 'translate(0, 0) scale(1.4) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 90}px) scale(1) rotate(-25deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.25) rotate(-60deg)`, opacity: 0.6 },
    ],
    { duration: 650, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' },
  );
  const land = () => {
    clone.remove();
    flying = Math.max(0, flying - 1);
    bumpBadge();
  };
  anim.onfinish = land;
  anim.oncancel = land;
}

/**
 * Adds one unit of a line, respecting today's stock. Returns false (and says why)
 * when nothing more can be added.
 */
export function addLine(key: string, art: SVGElement | null): boolean {
  const line = resolveLine(key);
  if (!line) return false;
  if (room(key) <= 0) {
    const left = remaining(line.productId);
    announce(
      left === 0
        ? `${line.name} esgotou por hoje.`
        : `Só ${left === 1 ? 'resta 1' : `restam ${left}`} de ${line.name} hoje, e já estão na sacola.`,
      true,
    );
    return false;
  }
  flyToBag(art);
  cart.add(key);
  announce(`${line.name} na sacola. ${plural(cart.get().items[key] ?? 0, 'unidade', 'unidades')}.`, true);
  return true;
}
