/**
 * Tracking page: reads the token from ?t=, shows the order and polls every 15 seconds
 * while the tab is visible, until the order is done or cancelled.
 * (The public role cannot subscribe to Realtime on pedidos, so this is a light poll.)
 */
import { formatBRL } from '../data/menu';
import { OrderError, online, trackOrder, type OrderStatus, type TrackedOrder } from './api';

const POLL_MS = 15_000;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const views = ['carregando', 'vazio', 'pedido'] as const;
function show(view: (typeof views)[number]) {
  for (const v of views) $(`[data-view="${v}"]`).hidden = v !== view;
}

function empty(title: string, text: string) {
  $('[data-vazio-titulo]').textContent = title;
  $('[data-vazio-texto]').textContent = text;
  show('vazio');
}

const ORDER: OrderStatus[] = ['recebido', 'separado', 'pronto', 'entregue'];

function steps(tipo: TrackedOrder['tipo']) {
  return tipo === 'entrega'
    ? ['Recebido', 'Separando', 'Pronto', 'Saiu para entrega']
    : ['Recebido', 'Separando', 'Pronto para retirar', 'Retirado'];
}

const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    .format(new Date(iso))
    .replace(/^0/, '')
    .replace(':00', 'h')
    .replace(':', 'h');

function quando(iso: string) {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  const day = fmt(new Date(iso));
  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 86_400_000));
  const label =
    day === today
      ? 'Hoje'
      : day === tomorrow
        ? 'Amanhã'
        : new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', timeZone: 'America/Sao_Paulo' })
            .format(new Date(iso))
            .replace(/^./, (c) => c.toUpperCase());
  return `${label}, ${hora(iso)}`;
}

function headline(o: TrackedOrder): [string, string] {
  const h = hora(o.horario);
  switch (o.status) {
    case 'recebido':
      return [`Recebemos seu pedido, ${o.nome}.`, 'A equipe já viu e começa a separar perto do horário.'];
    case 'separado':
      return ['Seu pedido está sendo separado.', 'Os sonhos são recheados na hora, pertinho do horário combinado.'];
    case 'pronto':
      return o.tipo === 'entrega'
        ? ['Pronto, esperando o entregador.', `Sai daqui a pouco para chegar por volta das ${h}.`]
        : ['Pronto! Pode vir buscar.', `Fica no balcão no seu nome a partir das ${h}.`];
    case 'entregue':
      return o.tipo === 'entrega'
        ? ['Saiu para entrega!', 'Está a caminho. Bom apetite!']
        : ['Retirado. Bom apetite!', 'Obrigada por pedir na Bendita.'];
    case 'cancelado':
      return ['Este pedido foi cancelado.', 'Se você não pediu o cancelamento, fale com a gente no balcão ou pelo telefone.'];
  }
}

let lastStatus: OrderStatus | null = null;

function render(o: TrackedOrder) {
  document.title = `Pedido ${o.codigo} · Bendita`;
  $('[data-codigo]').textContent = `Pedido ${o.codigo}`;

  // Only rewrite the live region when the status changes, so screen readers hear changes, not every poll.
  if (o.status !== lastStatus) {
    const [title, text] = headline(o);
    $('[data-titulo]').textContent = title;
    $('[data-texto]').textContent = text;
    lastStatus = o.status;
  }

  const list = $('[data-steps]');
  list.classList.toggle('cancelado', o.status === 'cancelado');
  const current = ORDER.indexOf(o.status);
  list.replaceChildren(
    ...steps(o.tipo).map((label, i) => {
      const li = document.createElement('li');
      li.textContent = label;
      if (i < current || (i === current && o.status === 'entregue')) li.className = 'feito';
      if (i === current && o.status !== 'entregue') li.setAttribute('aria-current', 'step');
      return li;
    }),
  );

  $('[data-quando-rotulo]').textContent = o.tipo === 'entrega' ? 'Entrega' : 'Retirada';
  $('[data-quando]').textContent = quando(o.horario);
  const extras = [o.taxa > 0 && 'com entrega', o.desconto > 0 && `${formatBRL(o.desconto)} de combo`].filter(Boolean);
  $('[data-total]').textContent = extras.length ? `${formatBRL(o.total)} (${extras.join(', ')})` : formatBRL(o.total);

  $('[data-itens]').replaceChildren(
    ...o.itens.map((item) => {
      const li = document.createElement('li');
      const qty = document.createElement('b');
      qty.textContent = `${item.quantidade}×`;
      li.append(qty, ` ${item.descricao}`);
      return li;
    }),
  );

  show('pedido');
}

const token = new URLSearchParams(location.search).get('t') ?? '';
let timer: number | undefined;
const finished = () => lastStatus === 'entregue' || lastStatus === 'cancelado';

async function load() {
  window.clearTimeout(timer);
  try {
    const order = await trackOrder(token);
    if (!order) {
      if (lastStatus === null) {
        empty('Não achamos esse pedido', 'Confira se o link está completo. Ele aparece na confirmação, logo depois de você fechar a sacola.');
      }
      return;
    }
    render(order);
    const now = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    $('[data-atualizado]').textContent = finished()
      ? `Atualizado às ${now}.`
      : `Atualizado às ${now}. Esta página se atualiza sozinha.`;
  } catch (err) {
    if (lastStatus === null) {
      empty('Sem conexão com a padaria', 'Não deu para buscar o pedido agora. Tente recarregar a página em instantes.');
    } else if (err instanceof OrderError) {
      $('[data-atualizado]').textContent = 'Sem conexão agora. Tentando de novo…';
    }
  }
  if (!finished() && !document.hidden) timer = window.setTimeout(load, POLL_MS);
}

if (!online) {
  empty(
    'Acompanhamento indisponível',
    'Este site está em modo demonstração: os pedidos são simulados no navegador e não ficam guardados.',
  );
} else if (!token) {
  empty('Nenhum pedido aqui', 'O link para acompanhar aparece na confirmação, logo depois de você fechar a sacola.');
} else {
  void load();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !finished()) void load();
    else window.clearTimeout(timer);
  });
}
