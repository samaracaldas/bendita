import { resolveLine } from '../data/catalog';
import { formatBRL } from '../data/menu';
import { OrderError, lastOrder, online, placeOrder, rememberOrder, trackUrl } from './api';
import { cartTotals, pickupOnlyLines } from './cart-math';
import { MAX_QTY, type CartState, type Fulfillment } from './cart-store';
import {
  addLine,
  announce,
  bumpBadge,
  cart,
  flying,
  hideToast,
  onStock,
  plural,
  refreshStock,
  remaining,
  room,
} from './shop';
import { getSlots } from './slots';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

const dialog = $<HTMLDialogElement>('#sacola');
const lineTpl = $<HTMLTemplateElement>('#linha-sacola');
const linesEl = $('[data-lines]', dialog);
const checkoutForm = $<HTMLFormElement>('[data-view="checkout"]', dialog);
const bagNotice = $('[data-bag-notice]', dialog);

const totals = (state: CartState) => cartTotals(state, resolveLine);

/* ---------- Rendering ---------- */
let lastCount = -1;

function renderHeader(count: number) {
  $('[data-cart-count]').textContent = String(count);
  $('[data-cart-count-sr]').textContent = count ? `, ${plural(count, 'item', 'itens')}` : ', vazia';
  if (lastCount !== -1 && count > lastCount && !flying) bumpBadge();
  lastCount = count;
}

/** Vitrine cards: how many are in the bag and today's stock. */
function renderCards(state: CartState) {
  for (const card of $$('[data-product]')) {
    const id = card.dataset.product!;
    const qty = state.items[id] ?? 0;
    const left = remaining(id);
    const soldOut = left <= 0;

    const tag = $('[data-in-cart]', card);
    tag.hidden = qty === 0;
    tag.textContent = qty ? `${qty} na sacola` : '';

    const stockTag = $('[data-stock]', card);
    stockTag.hidden = !(soldOut || left <= 10);
    stockTag.textContent = soldOut ? 'Esgotado hoje' : left === 1 ? 'Resta 1 hoje' : `Restam ${left} hoje`;
    stockTag.classList.toggle('out', soldOut);
    card.classList.toggle('sold-out', soldOut);

    const add = $<HTMLButtonElement>('[data-add]', card);
    add.disabled = soldOut || qty >= MAX_QTY;
    add.textContent = soldOut ? 'Esgotado' : 'Quero esse';
    const name = $('h3', card).textContent?.trim() ?? '';
    add.setAttribute('aria-label', soldOut ? `${name}: esgotado hoje` : `Quero esse: ${name}`);
  }
}

function renderLines(state: CartState) {
  const entries = Object.entries(state.items);
  const active = document.activeElement as HTMLElement | null;
  const focusedKey = active?.closest<HTMLElement>('[data-line]')?.dataset.line;
  const focusedRole = active?.dataset;

  linesEl.replaceChildren(
    ...entries.map(([key, qty]) => {
      const line = resolveLine(key)!;
      const li = (lineTpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
      li.dataset.line = key;
      $('[data-name]', li).textContent = line.name;
      $('[data-unit]', li).textContent = `${formatBRL(line.price)} cada · ${line.detail}`;
      $('[data-qty]', li).textContent = String(qty);
      $('[data-line-total]', li).textContent = formatBRL(line.price * qty);
      $('.stepper', li).setAttribute('aria-label', `Quantidade de ${line.name}`);
      const dec = $<HTMLButtonElement>('[data-dec]', li);
      const inc = $<HTMLButtonElement>('[data-inc]', li);
      dec.setAttribute('aria-label', qty === 1 ? `Remover ${line.name}` : `Diminuir ${line.name}`);
      inc.setAttribute('aria-label', `Aumentar ${line.name}`);
      inc.disabled = room(key) <= 0;
      $('[data-remove]', li).setAttribute('aria-label', `Remover ${line.name} da sacola`);
      return li;
    }),
  );

  // Re-rendering replaces nodes; put focus back where the person was.
  if (focusedKey && focusedRole) {
    const li = linesEl.querySelector<HTMLElement>(`[data-line="${CSS.escape(focusedKey)}"]`);
    const sel = 'inc' in focusedRole ? '[data-inc]' : 'dec' in focusedRole ? '[data-dec]' : null;
    const target = li && sel ? li.querySelector<HTMLButtonElement>(sel) : null;
    if (target && !target.disabled) target.focus();
    else if (dialog.open && !li) $<HTMLElement>(entries.length ? '[data-go-checkout]' : '[data-go-vitrine]', dialog).focus();
  }
}

/** Drinks can't go out for delivery: say so and hold the checkout until it's sorted. */
function renderPickupRule(state: CartState) {
  const drinks = pickupOnlyLines(state, resolveLine);
  const blocked = state.fulfillment === 'entrega' && drinks.length > 0;
  const note = $('[data-pickup-note]', dialog);
  note.hidden = !blocked;
  if (blocked) {
    const names = new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(drinks.map((d) => d.name));
    note.textContent = `Bebida não viaja bem: ${names} ${drinks.length === 1 ? 'é' : 'são'} só para retirar no balcão. Tire da sacola ou escolha retirar.`;
  }
  const go = $<HTMLButtonElement>('[data-go-checkout]', dialog);
  go.disabled = blocked;
  if (blocked) go.setAttribute('aria-describedby', 'aviso-retirada');
  else go.removeAttribute('aria-describedby');
}

function renderTotals(state: CartState) {
  const t = totals(state);
  $$('[data-subtotal]', dialog).forEach((el) => (el.textContent = formatBRL(t.subtotal)));
  $('[data-combo-row]', dialog).hidden = t.combos === 0;
  $('[data-combo-label]', dialog).textContent =
    t.combos > 1 ? `Combo sonho + café (${t.combos}×)` : 'Combo sonho + café';
  $('[data-discount]', dialog).textContent = `− ${formatBRL(t.discount)}`;
  $$('[data-fee]', dialog).forEach((el) => (el.textContent = t.fee ? formatBRL(t.fee) : 'Grátis'));
  $$('[data-total]', dialog).forEach((el) => (el.textContent = formatBRL(t.total)));
  $$<HTMLInputElement>('input[name="fulfillment"]', dialog).forEach((r) => (r.checked = r.value === state.fulfillment));
}

function render(state: CartState = cart.get()) {
  const { count } = totals(state);
  renderHeader(count);
  renderCards(state);
  renderLines(state);
  renderTotals(state);
  renderPickupRule(state);
  $('[data-empty]', dialog).hidden = count > 0;
  $('[data-filled]', dialog).hidden = count === 0;
  if (count === 0) bagNotice.hidden = true;
  // Emptied while on the checkout step (e.g. from another tab): go back.
  if (count === 0 && currentView === 'checkout') showView('cart');
}

/* ---------- Views ---------- */
type View = 'cart' | 'checkout' | 'done';
let currentView: View = 'cart';

function showView(view: View) {
  currentView = view;
  $$('[data-view]', dialog).forEach((el) => (el.hidden = el.dataset.view !== view));
  $('[data-title]', dialog).textContent =
    view === 'cart' ? 'Sua sacola' : view === 'checkout' ? 'Quase lá' : 'Pedido anotado!';
}

function openCart() {
  if (currentView === 'done') showView('cart');
  if (!dialog.open) dialog.showModal();
  hideToast();
}

const closeCart = () => dialog.close();

dialog.addEventListener('close', () => {
  if (currentView === 'done') showView('cart');
  $<HTMLElement>('[data-cart-open]').focus();
});

// Click on the backdrop closes the drawer.
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closeCart();
});

/* ---------- Checkout ---------- */

/** The shop's wall clock: slots are always in São Paulo time, whatever the visitor's time zone. */
const nowInSaoPaulo = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

function fillSlots(fulfillment: Fulfillment) {
  const select = $<HTMLSelectElement>('#pedido-horario');
  const previous = select.value;
  const slots = getSlots(nowInSaoPaulo());
  select.replaceChildren(new Option('Escolha um horário', ''), ...slots.map((s) => new Option(s.label, s.value)));
  if (slots.some((s) => s.value === previous)) select.value = previous;
  $('[data-slot-label]', dialog).textContent = fulfillment === 'entrega' ? 'Horário de entrega' : 'Horário de retirada';
  $('[data-address-field]', dialog).hidden = fulfillment !== 'entrega';
}

function setError(name: string, message: string) {
  const field = checkoutForm.elements.namedItem(name) as HTMLInputElement | null;
  field?.setAttribute('aria-invalid', message ? 'true' : 'false');
  $(`[data-error-for="${name}"]`, checkoutForm).textContent = message;
}

const MESSAGES: Record<string, string> = {
  nome: 'Diga um nome para o pedido.',
  horario: 'Escolha um horário.',
  endereco: 'Precisamos do endereço com número.',
};

function validate(): boolean {
  const data = new FormData(checkoutForm);
  const nome = String(data.get('nome') ?? '').trim();
  const horario = String(data.get('horario') ?? '');
  const endereco = String(data.get('endereco') ?? '').trim();
  const delivery = cart.get().fulfillment === 'entrega';

  const errors: Record<string, string> = {
    nome: nome.length < 2 ? MESSAGES.nome : '',
    horario: horario ? '' : MESSAGES.horario,
    endereco: delivery && endereco.length < 6 ? MESSAGES.endereco : '',
  };
  Object.entries(errors).forEach(([k, v]) => setError(k, v));
  const firstInvalid = Object.keys(errors).find((k) => errors[k]);
  if (firstInvalid) (checkoutForm.elements.namedItem(firstInvalid) as HTMLElement).focus();
  return !firstInvalid;
}

function setSubmitting(on: boolean) {
  const button = $<HTMLButtonElement>('[type="submit"]', checkoutForm);
  button.disabled = on;
  button.textContent = on ? 'Enviando pedido…' : 'Confirmar pedido';
  checkoutForm.setAttribute('aria-busy', String(on));
}

/** Back to the bag with a message about what has to change. */
function backToBag(message: string) {
  bagNotice.textContent = message;
  bagNotice.hidden = false;
  showView('cart');
  bagNotice.focus();
}

function explain(err: unknown) {
  if (!(err instanceof OrderError)) return backToBag('Não deu para enviar o pedido. Tente de novo.');
  switch (err.kind) {
    case 'esgotado': {
      const name = [...Object.keys(cart.get().items)].map(resolveLine).find((l) => l?.productId === err.ref)?.name;
      const left = err.restantes ?? 0;
      void refreshStock();
      return backToBag(
        left === 0
          ? `${name ?? 'Um dos itens'} esgotou para esse dia. Tire da sacola ou escolha outro dia.`
          : `Para esse dia só ${left === 1 ? 'resta 1' : `restam ${left}`} de ${name ?? 'um dos itens'}. Ajuste a quantidade ou escolha outro dia.`,
      );
    }
    case 'horario':
      fillSlots(cart.get().fulfillment);
      setError('horario', 'Esse horário não está mais disponível. Escolha outro.');
      return $<HTMLElement>('#pedido-horario').focus();
    case 'dados':
      if (err.ref && MESSAGES[err.ref]) {
        setError(err.ref, MESSAGES[err.ref]);
        return (checkoutForm.elements.namedItem(err.ref) as HTMLElement | null)?.focus();
      }
      return backToBag('Algum dado do pedido não confere. Revise e tente de novo.');
    case 'item':
      if (err.ref) cart.remove(err.ref);
      return backToBag('Um item da sacola saiu do cardápio e foi removido. Confira antes de continuar.');
    case 'retirada':
      cart.setFulfillment('retirada');
      return backToBag('Bebida é só para retirar no balcão. Mudamos para retirada; confira e continue.');
    case 'limite':
      if (err.ref === 'unidades') {
        return backToBag(
          `Pelo site dá para pedir até ${err.restantes ?? 60} unidades de uma vez. Para quantidades maiores, faça uma encomenda de festa.`,
        );
      }
      return backToBag(
        err.ref === 'origem'
          ? 'Você já fez vários pedidos nos últimos minutos. Espere um pouco antes de mandar outro; sua sacola continua salva.'
          : 'A padaria está recebendo muitos pedidos agora. Tente de novo em alguns minutos; sua sacola continua salva.',
      );
    default:
      return backToBag('Sem conexão com a padaria agora. Sua sacola continua salva; tente de novo em instantes.');
  }
}

checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validate() || checkoutForm.getAttribute('aria-busy') === 'true') return;

  const state = cart.get();
  const t = totals(state);
  const data = new FormData(checkoutForm);
  const select = $<HTMLSelectElement>('#pedido-horario');
  const when = select.selectedOptions[0]?.textContent ?? '';
  const nome = String(data.get('nome')).trim();

  setSubmitting(true);
  try {
    const result = await placeOrder(
      {
        nome,
        tipo: state.fulfillment,
        endereco: state.fulfillment === 'entrega' ? String(data.get('endereco') ?? '').trim() : null,
        horario: `${select.value}:00-03:00`,
        obs: String(data.get('obs') ?? '').trim() || null,
        itens: Object.entries(state.items).map(([linha, quantidade]) => ({ linha, quantidade })),
      },
      { subtotal: t.subtotal, taxa: t.fee, total: t.total },
    );

    $('[data-order-code]', dialog).textContent = `Pedido ${result.codigo}`;
    $('[data-order-summary]', dialog).textContent =
      state.fulfillment === 'entrega'
        ? `${nome}, ${plural(t.count, 'item', 'itens')} saem para entrega ${when.toLowerCase()}. Total: ${formatBRL(result.total)}.`
        : `${nome}, ${plural(t.count, 'item', 'itens')} ficam no balcão no seu nome, ${when.toLowerCase()}. Total: ${formatBRL(result.total)}.`;
    const track = $<HTMLAnchorElement>('[data-order-track]', dialog);
    track.hidden = !result.token;
    if (result.token) {
      track.href = trackUrl(result.token);
      rememberOrder({ codigo: result.codigo, token: result.token });
      showLastOrder();
    }
    $('[data-order-note]', dialog).textContent = online
      ? 'Pagamento na retirada ou na entrega. Nada foi cobrado agora.'
      : 'Isto foi uma simulação: o site está em modo demonstração e nada foi enviado.';

    cart.clear();
    checkoutForm.reset();
    showView('done');
    $('[data-view="done"]', dialog).focus();
    announce(`Pedido ${result.codigo} anotado.`);
    void refreshStock();
  } catch (err) {
    explain(err);
  } finally {
    setSubmitting(false);
  }
});

/* ---------- Last order ---------- */
function showLastOrder() {
  const link = document.querySelector<HTMLAnchorElement>('[data-last-order]');
  const last = lastOrder();
  if (!link || !last) return;
  link.href = trackUrl(last.token);
  link.setAttribute('aria-label', `Acompanhar o pedido ${last.codigo}`);
  link.hidden = false;
}
showLastOrder();

/* ---------- Events ---------- */
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const add = target.closest<HTMLElement>('[data-add]');
  if (add) {
    const card = add.closest('[data-product]');
    addLine(add.dataset.add!, card?.querySelector<SVGElement>('svg') ?? null);
    return;
  }

  if (target.closest('[data-cart-open]')) return openCart();
  if (target.closest('[data-cart-close]')) return closeCart();

  if (target.closest('[data-go-vitrine]')) {
    closeCart();
    const vitrine = document.getElementById('vitrine');
    if (vitrine) vitrine.scrollIntoView();
    else location.href = '/#vitrine';
    return;
  }

  if (target.closest('[data-go-checkout]')) {
    bagNotice.hidden = true;
    fillSlots(cart.get().fulfillment);
    showView('checkout');
    $<HTMLInputElement>('#pedido-nome').focus();
    return;
  }

  if (target.closest('[data-back]')) {
    showView('cart');
    $<HTMLElement>('[data-go-checkout]', dialog).focus();
    return;
  }

  if (target.closest('[data-clear]')) {
    cart.clear();
    announce('Sacola esvaziada.');
    return;
  }

  const lineEl = target.closest<HTMLElement>('[data-line]');
  if (lineEl) {
    const key = lineEl.dataset.line!;
    const line = resolveLine(key)!;
    const qty = cart.get().items[key] ?? 0;
    if (target.closest('[data-inc]')) {
      if (room(key) > 0) {
        cart.setQty(key, qty + 1);
        announce(`${line.name}: ${qty + 1}.`);
      }
    } else if (target.closest('[data-dec]')) {
      cart.setQty(key, qty - 1);
      announce(qty - 1 ? `${line.name}: ${qty - 1}.` : `${line.name} removido da sacola.`);
    } else if (target.closest('[data-remove]')) {
      cart.remove(key);
      announce(`${line.name} removido da sacola.`);
    }
  }
});

dialog.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'fulfillment') {
    cart.setFulfillment(input.value as Fulfillment);
    fillSlots(input.value as Fulfillment);
  }
});

// Clear a field's error while the person fixes it. Doing this on `change` (blur)
// would shift the layout during the click on "Confirmar" and swallow that click.
dialog.addEventListener('input', (e) => {
  const field = e.target as HTMLInputElement;
  if (field.name !== 'fulfillment' && field.getAttribute('aria-invalid') === 'true') setError(field.name, '');
});

// Header border once the page scrolls.
const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

$('[data-checkout-note]', dialog).textContent = online
  ? 'Você paga na retirada ou na entrega. Nada é cobrado agora.'
  : 'Modo demonstração: o pedido é simulado e nenhum dado sai do seu navegador.';

cart.subscribe(render);
onStock(() => render());
void refreshStock();

