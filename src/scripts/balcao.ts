/**
 * Painel do balcão: staff login, the day's orders by status (live via Supabase
 * Realtime) and the day's stock. Everything here is protected by RLS in the database;
 * the UI only hides what the policies would refuse anyway.
 */
import { createClient, type RealtimeChannel, type Session } from '@supabase/supabase-js';
import { formatBRL } from '../data/menu';

type Status = 'recebido' | 'separado' | 'pronto' | 'entregue' | 'cancelado';

interface Pedido {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'retirada' | 'entrega';
  endereco: string | null;
  horario: string;
  obs: string | null;
  total: number;
  status: Status;
  itens_pedido: { descricao: string; quantidade: number; produto_id: string }[];
}

type StatusEncomenda = 'nova' | 'confirmada' | 'pronta' | 'entregue' | 'cancelada';

interface Encomenda {
  id: string;
  codigo: string;
  nome: string;
  telefone: string;
  data_evento: string;
  periodo: 'manha' | 'tarde';
  tipo: 'retirada' | 'entrega';
  endereco: string | null;
  obs: string | null;
  total: number;
  status: StatusEncomenda;
  itens_encomenda: { descricao: string; quantidade: number }[];
}

const ENC_NEXT: Partial<Record<StatusEncomenda, { to: StatusEncomenda; label: (e: Encomenda) => string }>> = {
  nova: { to: 'confirmada', label: () => 'Confirmar' },
  confirmada: { to: 'pronta', label: () => 'Marcar pronta' },
  pronta: { to: 'entregue', label: (e) => (e.tipo === 'entrega' ? 'Saiu para entrega' : 'Retirada') },
};

const ENC_LABEL: Record<StatusEncomenda, string> = {
  nova: 'Nova',
  confirmada: 'Confirmada',
  pronta: 'Pronta',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

/** Product id -> thumbnail URL, written into the page at build time. */
const THUMBS: Record<string, string> = JSON.parse(document.getElementById('fotos-produtos')?.textContent || '{}');

const URL = import.meta.env.PUBLIC_SUPABASE_URL;
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

const show = (view: 'offline' | 'login' | 'forbidden' | 'board') =>
  $$('[data-view]').forEach((el) => (el.hidden = el.dataset.view !== view));

const announcer = $('[data-announcer]');
const announce = (msg: string) => {
  announcer.textContent = '';
  requestAnimationFrame(() => (announcer.textContent = msg));
};

const NEXT: Partial<Record<Status, { to: Status; label: (p: Pedido) => string }>> = {
  recebido: { to: 'separado', label: () => 'Separar' },
  separado: { to: 'pronto', label: () => 'Marcar pronto' },
  pronto: { to: 'entregue', label: (p) => (p.tipo === 'entrega' ? 'Saiu para entrega' : 'Retirado') },
};

const STATUS_LABEL: Record<Status, string> = {
  recebido: 'Recebido',
  separado: 'Separado',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(
    new Date(iso),
  );

if (!URL || !KEY) {
  show('offline');
} else {
  const supabase = createClient(URL, KEY);
  const diaInput = $<HTMLInputElement>('[data-dia]');
  diaInput.value = hojeSP();
  let channel: RealtimeChannel | null = null;
  /** Read-only visitor: buttons are disabled here, and the database refuses changes anyway. */
  let readonly = false;
  const lockButtons = (root: ParentNode) => {
    if (!readonly) return;
    root
      .querySelectorAll<HTMLButtonElement>('[data-advance], [data-cancel], [data-enc-advance], [data-enc-cancel], .stock-qty button')
      .forEach((b) => {
        b.disabled = true;
        b.title = 'Modo visitante: só leitura';
      });
  };

  const VISIT_EMAIL = import.meta.env.PUBLIC_BALCAO_VISITANTE_EMAIL;
  const VISIT_PASS = import.meta.env.PUBLIC_BALCAO_VISITANTE_SENHA;
  if (VISIT_EMAIL && VISIT_PASS) {
    $('[data-visitante]').hidden = false;
    $<HTMLButtonElement>('[data-visitante-entrar]').addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.disabled = true;
      const { error: err } = await supabase.auth.signInWithPassword({ email: VISIT_EMAIL, password: VISIT_PASS });
      button.disabled = false;
      if (err) $('[data-login-error]').textContent = 'O acesso de visitante está indisponível agora.';
    });
  }
  let known = new Set<string>();
  let firstLoad = true;

  /* ---------- Session ---------- */
  async function enter(session: Session | null) {
    $('[data-session]').hidden = !session;
    if (!session) {
      channel?.unsubscribe();
      channel = null;
      return show('login');
    }
    $('[data-user]').textContent = session.user.email ?? '';
    const { data: ok } = await supabase.rpc('eh_equipe');
    if (!ok) return show('forbidden');
    const { data: papel } = await supabase.rpc('papel_atual');
    readonly = papel === 'visitante';
    $('[data-readonly-banner]').hidden = !readonly;
    show('board');
    await Promise.all([loadOrders(), loadStock(), loadEncomendas()]);
    subscribe();
  }

  $<HTMLFormElement>('[data-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const error = $('[data-login-error]');
    error.textContent = '';
    const button = $<HTMLButtonElement>('button[type="submit"]', form);
    button.disabled = true;
    const { error: err } = await supabase.auth.signInWithPassword({
      email: String(data.get('email')).trim(),
      password: String(data.get('senha')),
    });
    button.disabled = false;
    if (err) {
      error.textContent = 'E-mail ou senha não conferem.';
      $<HTMLInputElement>('#login-senha').select();
    } else {
      form.reset();
    }
  });

  $('[data-logout]').addEventListener('click', () => supabase.auth.signOut());

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      // Run outside the auth callback (supabase-js recommends not awaiting inside it).
      setTimeout(() => void enter(session), 0);
    }
  });

  /* ---------- Orders ---------- */
  const dayRange = (dia: string) => {
    const start = new Date(`${dia}T00:00:00-03:00`);
    return [start.toISOString(), new Date(start.getTime() + 86_400_000).toISOString()] as const;
  };

  async function loadOrders() {
    const [from, to] = dayRange(diaInput.value);
    const { data, error } = await supabase
      .from('pedidos')
      .select('id, codigo, nome, tipo, endereco, horario, obs, total, status, itens_pedido(descricao, quantidade, produto_id)')
      .gte('horario', from)
      .lt('horario', to)
      .order('horario')
      .order('criado_em');
    if (error) return announce('Não deu para carregar os pedidos.');
    renderOrders(data as Pedido[]);
  }

  function renderOrders(pedidos: Pedido[]) {
    const tpl = $<HTMLTemplateElement>('#pedido');
    const cols: Record<string, HTMLElement[]> = { recebido: [], separado: [], pronto: [], fechados: [] };

    for (const p of pedidos) {
      const li = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
      li.dataset.id = p.id;
      li.classList.add(p.status);
      if (!firstLoad && !known.has(p.id)) li.classList.add('new');
      $('[data-when]', li).textContent = hora(p.horario);
      $('[data-code]', li).textContent = p.codigo;
      const kind = $('[data-kind]', li);
      kind.textContent = p.tipo === 'entrega' ? 'Entrega' : 'Retirada';
      kind.classList.add(p.tipo);
      $('[data-who]', li).textContent = p.nome;
      $('[data-address]', li).textContent = p.endereco ?? '';
      $('[data-obs]', li).textContent = p.obs ? `“${p.obs}”` : '';
      $('[data-items]', li).replaceChildren(
        ...p.itens_pedido.map((i) => {
          const item = document.createElement('li');
          const src = THUMBS[i.produto_id];
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            img.width = 40;
            img.height = 40;
            img.loading = 'lazy';
            item.append(img);
          }
          const text = document.createElement('span');
          const qty = document.createElement('b');
          qty.textContent = `${i.quantidade} ×`;
          text.append(qty, ` ${i.descricao}`);
          item.append(text);
          return item;
        }),
      );
      $('[data-total]', li).textContent = formatBRL(p.total);

      const next = NEXT[p.status];
      const advance = $<HTMLButtonElement>('[data-advance]', li);
      const cancel = $<HTMLButtonElement>('[data-cancel]', li);
      if (next) {
        advance.textContent = next.label(p);
        advance.dataset.to = next.to;
        advance.setAttribute('aria-label', `${next.label(p)}: pedido ${p.codigo} de ${p.nome}`);
        cancel.setAttribute('aria-label', `Cancelar pedido ${p.codigo}`);
      } else {
        $('.actions', li).remove();
        $('[data-status-label]', li).textContent = STATUS_LABEL[p.status];
      }

      const col = p.status === 'entregue' || p.status === 'cancelado' ? 'fechados' : p.status;
      cols[col].push(li);
    }

    for (const [col, items] of Object.entries(cols)) {
      $(`[data-col="${col}"]`).replaceChildren(...items);
      $(`[data-count="${col}"]`).textContent = String(items.length);
    }
    lockButtons(document);

    if (!firstLoad) {
      const fresh = pedidos.filter((p) => !known.has(p.id));
      fresh.forEach((p) => announce(`Novo pedido ${p.codigo} de ${p.nome} para ${hora(p.horario)}.`));
    }
    known = new Set(pedidos.map((p) => p.id));
    firstLoad = false;
  }

  async function setStatus(id: string, status: Status) {
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id);
    if (error) announce('Não deu para mudar o status. Tente de novo.');
    else announce(`Pedido marcado como ${STATUS_LABEL[status].toLowerCase()}.`);
    await Promise.all([loadOrders(), status === 'cancelado' ? loadStock() : null]);
  }

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const order = target.closest<HTMLElement>('.order');
    if (!order) return;
    const id = order.dataset.id!;
    const advance = target.closest<HTMLElement>('[data-advance]');
    if (advance) return void setStatus(id, advance.dataset.to as Status);
    if (target.closest('[data-cancel]')) {
      $('[data-confirm]', order).hidden = false;
      $('.actions', order).hidden = true;
      return $<HTMLButtonElement>('[data-confirm-no]', order).focus();
    }
    if (target.closest('[data-confirm-no]')) {
      $('[data-confirm]', order).hidden = true;
      $('.actions', order).hidden = false;
      return $<HTMLButtonElement>('[data-cancel]', order).focus();
    }
    if (target.closest('[data-confirm-yes]')) return void setStatus(id, 'cancelado');
  });

  const hojeBtn = $<HTMLButtonElement>('[data-dia-hoje]');
  const setDia = (value: string) => {
    if (!value || value === diaInput.value) return;
    diaInput.value = value;
    diaInput.dispatchEvent(new Event('change'));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-dia-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // Noon UTC keeps the date stable whatever the browser's time zone.
      const d = new Date(`${diaInput.value || hojeSP()}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(btn.dataset.diaStep));
      setDia(d.toISOString().slice(0, 10));
    }),
  );
  hojeBtn.addEventListener('click', () => setDia(hojeSP()));

  diaInput.addEventListener('change', () => {
    hojeBtn.hidden = diaInput.value === hojeSP();
    firstLoad = true;
    void Promise.all([loadOrders(), loadStock()]);
  });

  /* ---------- Stock ---------- */
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function loadStock() {
    const dia = diaInput.value;
    const [produtos, estoque] = await Promise.all([
      supabase.from('produtos').select('id, nome, estoque_padrao').eq('ativo', true).order('categoria').order('nome'),
      supabase.from('estoque').select('produto_id, quantidade, reservado').eq('dia', dia),
    ]);
    if (produtos.error || estoque.error) return announce('Não deu para carregar o estoque.');
    const byId = new Map(estoque.data.map((e) => [e.produto_id, e]));

    $('[data-stock]').replaceChildren(
      ...produtos.data.map((p) => {
        const e = byId.get(p.id);
        const total = e?.quantidade ?? p.estoque_padrao;
        const vendidos = e?.reservado ?? 0;
        const restam = total - vendidos;
        // Built with DOM calls, not an HTML string: product names never become markup.
        const tr = el('tr');
        const name = el('th', p.nome);
        name.scope = 'row';
        const left = el('td', String(restam));
        if (restam <= 3) left.className = 'low';
        const less = el('button', '−');
        less.type = 'button';
        less.dataset.step = '-1';
        less.disabled = total <= vendidos;
        less.setAttribute('aria-label', `Uma unidade a menos de ${p.nome}`);
        const more = el('button', '+');
        more.type = 'button';
        more.dataset.step = '1';
        more.setAttribute('aria-label', `Uma unidade a mais de ${p.nome}`);
        const qty = el('span');
        qty.className = 'stock-qty';
        qty.append(less, el('output', String(total)), more);
        const cell = el('td');
        cell.append(qty);
        tr.append(name, el('td', String(vendidos)), left, cell);
        tr.dataset.produto = p.id;
        tr.dataset.total = String(total);
        return tr;
      }),
    );
    lockButtons($('[data-stock]'));
  }

  $('[data-stock]').addEventListener('click', async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
    if (!button) return;
    const tr = button.closest<HTMLElement>('tr')!;
    const quantidade = Number(tr.dataset.total) + Number(button.dataset.step);
    const { error } = await supabase.rpc('ajustar_estoque', {
      p_produto: tr.dataset.produto,
      p_dia: diaInput.value,
      p_quantidade: quantidade,
    });
    if (error) announce(error.message === 'abaixo_do_reservado' ? 'Já foram vendidas mais unidades que isso.' : 'Não deu para ajustar.');
    await loadStock();
    $<HTMLButtonElement>(`tr[data-produto="${tr.dataset.produto}"] [data-step="${button.dataset.step}"]`)?.focus();
  });

  /* ---------- Party orders ---------- */
  async function loadEncomendas() {
    const { data, error } = await supabase
      .from('encomendas')
      .select('id, codigo, nome, telefone, data_evento, periodo, tipo, endereco, obs, total, status, itens_encomenda(descricao, quantidade)')
      .gte('data_evento', hojeSP())
      .order('data_evento')
      .order('periodo')
      .order('criado_em');
    if (error) return announce('Não deu para carregar as encomendas.');
    renderEncomendas(data as Encomenda[]);
  }

  const diaFesta = (e: Encomenda) =>
    `${new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
      .format(new Date(`${e.data_evento}T12:00:00Z`))
      .replace('.', '')} · ${e.periodo === 'manha' ? 'manhã' : 'tarde'}`;

  const telefoneBonito = (t: string) =>
    t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;

  function renderEncomendas(lista: Encomenda[]) {
    const tpl = $<HTMLTemplateElement>('#encomenda');
    const items = lista.map((e) => {
      const li = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
      li.dataset.encomenda = e.id;
      li.classList.add(e.status);
      $('[data-enc-when]', li).textContent = diaFesta(e);
      $('[data-enc-code]', li).textContent = e.codigo;
      $('[data-enc-status]', li).textContent = ENC_LABEL[e.status];
      $('[data-enc-who]', li).textContent = e.nome;
      const whats = $<HTMLAnchorElement>('[data-enc-whats]', li);
      whats.href = `https://wa.me/55${e.telefone}`;
      whats.textContent = `WhatsApp ${telefoneBonito(e.telefone)}`;
      whats.setAttribute('aria-label', `Abrir WhatsApp de ${e.nome}, ${telefoneBonito(e.telefone)}`);
      $('[data-enc-address]', li).textContent = e.tipo === 'entrega' ? `Entrega: ${e.endereco}` : 'Retirada no balcão';
      $('[data-enc-obs]', li).textContent = e.obs ? `“${e.obs}”` : '';
      $('[data-enc-items]', li).replaceChildren(
        ...e.itens_encomenda.map((i) => {
          const item = document.createElement('li');
          const text = document.createElement('span');
          const qty = document.createElement('b');
          qty.textContent = `${i.quantidade} ${i.quantidade > 1 ? 'centos' : 'cento'}`;
          text.append(qty, ` ${i.descricao}`);
          item.append(text);
          return item;
        }),
      );
      $('[data-enc-total]', li).textContent = formatBRL(e.total);
      const next = ENC_NEXT[e.status];
      const advance = $<HTMLButtonElement>('[data-enc-advance]', li);
      if (next) {
        advance.textContent = next.label(e);
        advance.dataset.to = next.to;
        advance.setAttribute('aria-label', `${next.label(e)}: encomenda ${e.codigo} de ${e.nome}`);
        $('[data-enc-cancel]', li).setAttribute('aria-label', `Cancelar encomenda ${e.codigo}`);
      } else {
        $('.actions', li).remove();
      }
      return li;
    });
    $('[data-encomendas]').replaceChildren(...items);
    lockButtons($('[data-encomendas]'));
    $('[data-count="encomendas"]').textContent = String(lista.filter((e) => e.status !== 'cancelada' && e.status !== 'entregue').length);
    $('[data-encomendas-vazio]').hidden = lista.length > 0;
  }

  async function setStatusEncomenda(id: string, status: StatusEncomenda) {
    const { error } = await supabase.from('encomendas').update({ status }).eq('id', id);
    if (error) announce('Não deu para mudar o status da encomenda. Tente de novo.');
    else announce(`Encomenda marcada como ${ENC_LABEL[status].toLowerCase()}.`);
    await loadEncomendas();
  }

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-encomenda]');
    if (!card) return;
    const id = card.dataset.encomenda!;
    const advance = target.closest<HTMLElement>('[data-enc-advance]');
    if (advance) return void setStatusEncomenda(id, advance.dataset.to as StatusEncomenda);
    if (target.closest('[data-enc-cancel]')) {
      $('[data-enc-confirm]', card).hidden = false;
      $('.actions', card).hidden = true;
      return $<HTMLButtonElement>('[data-enc-no]', card).focus();
    }
    if (target.closest('[data-enc-no]')) {
      $('[data-enc-confirm]', card).hidden = true;
      $('.actions', card).hidden = false;
      return $<HTMLButtonElement>('[data-enc-cancel]', card).focus();
    }
    if (target.closest('[data-enc-yes]')) return void setStatusEncomenda(id, 'cancelada');
  });

  /* ---------- Realtime ---------- */
  function subscribe() {
    channel?.unsubscribe();
    const live = $('[data-live]');
    channel = supabase
      .channel('pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        void loadOrders();
        void loadStock();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encomendas' }, (payload) => {
        if (payload.eventType === 'INSERT') announce(`Nova encomenda de festa: ${(payload.new as Encomenda).codigo}.`);
        void loadEncomendas();
      })
      .subscribe((status) => {
        const on = status === 'SUBSCRIBED';
        live.classList.toggle('on', on);
        live.textContent = on ? 'Ao vivo' : 'Reconectando…';
      });
  }
}
