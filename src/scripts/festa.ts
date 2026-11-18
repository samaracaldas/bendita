/** Party order form: centos per kit, flavors, date and contact. Same rules as criar_encomenda. */
import {
  KITS,
  MAX_CENTOS,
  PERIODOS,
  descricaoItem,
  janelaDatas,
  kitById,
  telefoneValido,
  limparTelefone,
  totaisFesta,
  validarData,
  validarItem,
  type ItemFesta,
  type Periodo,
} from '../data/festa';
import { formatBRL } from '../data/menu';
import { OrderError, online, placePartyOrder } from './api';

const form = document.querySelector<HTMLFormElement>('[data-festa]');

if (form) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = form) => root.querySelector<T>(sel)!;
  const done = document.querySelector<HTMLElement>('[data-festa-done]')!;
  const notice = $('[data-festa-notice]');
  const dataInput = $<HTMLInputElement>('#festa-data');

  const window_ = janelaDatas(new Date());
  dataInput.min = window_.min;
  dataInput.max = window_.max;

  $('[data-festa-note]').textContent = online
    ? 'Nada é cobrado agora: a gente confirma pelo WhatsApp e você paga na retirada ou na entrega.'
    : 'Modo demonstração: a encomenda é simulada no navegador e nada é enviado.';

  /* ---------- State ---------- */
  const qtd: Record<string, number> = Object.fromEntries(KITS.map((k) => [k.id, 0]));

  const kitEl = (id: string) => $(`[data-kit="${id}"]`);
  const saboresDe = (id: string) =>
    [...kitEl(id).querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((i) => i.value);

  const itens = (): ItemFesta[] =>
    KITS.filter((k) => qtd[k.id] > 0).map((k) => ({ kit: k.id, quantidade: qtd[k.id], sabores: saboresDe(k.id) }));

  const tipo = () => (new FormData(form).get('tipo') as 'retirada' | 'entrega') ?? 'retirada';

  /* ---------- Rendering ---------- */
  function renderKit(id: string) {
    const el = kitEl(id);
    const n = qtd[id];
    el.classList.toggle('on', n > 0);
    $('[data-qtd]', el).textContent = String(n);
    $<HTMLButtonElement>('[data-step="-1"]', el).disabled = n === 0;
    $<HTMLButtonElement>('[data-step="1"]', el).disabled = n >= MAX_CENTOS;
    const sabores = el.querySelector<HTMLElement>('[data-sabores]');
    if (sabores) {
      sabores.hidden = n === 0;
      // At the limit, the unchecked flavors are disabled.
      const max = kitById(id)!.maxSabores;
      const boxes = [...sabores.querySelectorAll<HTMLInputElement>('input')];
      const checked = boxes.filter((b) => b.checked).length;
      boxes.forEach((b) => (b.disabled = !b.checked && checked >= max));
    }
  }

  function renderTotals() {
    const t = totaisFesta(itens(), tipo());
    $('[data-festa-subtotal]').textContent = formatBRL(t.subtotal);
    $('[data-festa-taxa]').textContent = t.taxa ? formatBRL(t.taxa) : 'Grátis';
    $('[data-festa-total]').textContent = formatBRL(t.total);
    $('[data-festa-endereco]', document).hidden = tipo() !== 'entrega';
  }

  function setError(field: string, message: string) {
    const out = form!.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
    if (out) out.textContent = message;
    const input = form!.elements.namedItem(field) as HTMLElement | null;
    if (input && 'setAttribute' in input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  const MESSAGES: Record<string, string> = {
    nome: 'Diga um nome para a encomenda.',
    telefone: 'Precisamos de um WhatsApp com DDD, como (11) 98888-7777.',
    endereco: 'Precisamos do endereço com número.',
    periodo: 'Escolha manhã ou tarde.',
    itens: 'Escolha pelo menos um cento.',
  };

  const DATE_MESSAGES = {
    invalida: 'Escolha o dia da festa.',
    cedo: 'Precisamos de pelo menos 2 dias de antecedência.',
    longe: 'Aceitamos encomendas até 60 dias à frente.',
    segunda: 'Segunda a padaria fecha. Escolha outro dia.',
  } as const;

  /** Checks every field, shows the messages and returns the first invalid element. */
  function validate(): HTMLElement | null {
    const data = new FormData(form!);
    const problems: [string, string][] = [];

    const lista = itens();
    if (lista.length === 0 || lista.some((i) => validarItem(i))) problems.push(['itens', MESSAGES.itens]);
    const dia = String(data.get('data') ?? '');
    const dateProblem = validarData(dia, new Date());
    if (dateProblem) problems.push(['data', DATE_MESSAGES[dateProblem]]);
    if (tipo() === 'entrega' && String(data.get('endereco') ?? '').trim().length < 6) problems.push(['endereco', MESSAGES.endereco]);
    if (String(data.get('nome') ?? '').trim().length < 2) problems.push(['nome', MESSAGES.nome]);
    if (!telefoneValido(String(data.get('telefone') ?? ''))) problems.push(['telefone', MESSAGES.telefone]);

    for (const f of ['itens', 'data', 'endereco', 'nome', 'telefone']) setError(f, '');
    problems.forEach(([f, m]) => setError(f, m));
    if (problems.length === 0) return null;
    const [first] = problems[0];
    return first === 'itens'
      ? $('[data-kit] [data-step="1"]')
      : (form!.elements.namedItem(first) as HTMLElement);
  }

  /* ---------- Events ---------- */
  form.addEventListener('click', (e) => {
    const step = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
    if (!step) return;
    const id = step.closest<HTMLElement>('[data-kit]')!.dataset.kit!;
    qtd[id] = Math.max(0, Math.min(MAX_CENTOS, qtd[id] + Number(step.dataset.step)));
    renderKit(id);
    renderTotals();
    if (qtd[id] > 0) setError('itens', '');
    // Keep focus usable when the button that was pressed gets disabled.
    if (step.disabled) $<HTMLButtonElement>(`[data-step="${-Number(step.dataset.step)}"]`, kitEl(id)).focus();
  });

  form.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type === 'checkbox') {
      const kit = input.closest<HTMLElement>('[data-kit]')!;
      // A kit with flavors always keeps at least one: unchecking the last one undoes itself.
      if (!input.checked && !kit.querySelector('input[type="checkbox"]:checked')) input.checked = true;
      renderKit(kit.dataset.kit!);
    }
    renderTotals();
  });

  form.addEventListener('input', (e) => {
    const field = e.target as HTMLInputElement;
    if (field.getAttribute('aria-invalid') === 'true') setError(field.name, '');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice.hidden = true;
    const invalid = validate();
    if (invalid) return invalid.focus();
    if (form.getAttribute('aria-busy') === 'true') return;

    const data = new FormData(form);
    const lista = itens();
    const t = totaisFesta(lista, tipo());
    const nome = String(data.get('nome')).trim();
    const dia = String(data.get('data'));
    const periodo = String(data.get('periodo')) as Periodo;

    form.setAttribute('aria-busy', 'true');
    const submit = $<HTMLButtonElement>('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await placePartyOrder(
        {
          nome,
          telefone: limparTelefone(String(data.get('telefone'))),
          data: dia,
          periodo,
          tipo: tipo(),
          endereco: tipo() === 'entrega' ? String(data.get('endereco')).trim() : null,
          obs: String(data.get('obs') ?? '').trim() || null,
          itens: lista,
        },
        t,
      );
      const quando = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
        .format(new Date(`${dia}T12:00:00Z`));
      const periodoNome = PERIODOS.find((p) => p.id === periodo)!.nome.split(',')[0].toLowerCase();
      $('[data-festa-codigo]', done).textContent = `Encomenda ${result.codigo}`;
      $('[data-festa-resumo]', done).textContent =
        `${nome}, anotamos ${lista.map(descricaoItem).map((d, i) => `${lista[i].quantidade} cento${lista[i].quantidade > 1 ? 's' : ''} de ${d}`).join('; ')} ` +
        `para ${quando}, de ${periodoNome}. Total: ${formatBRL(result.total)}.`;
      $('[data-festa-done-note]', done).textContent = online
        ? 'A gente confirma pelo WhatsApp em até 1 dia útil. Nada foi cobrado agora.'
        : 'Isto foi uma simulação: o site está em modo demonstração e nada foi enviado.';
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (err) {
      notice.hidden = false;
      if (err instanceof OrderError && err.kind === 'dados' && err.ref) {
        notice.hidden = true;
        const message = err.ref === 'data' ? DATE_MESSAGES.cedo : MESSAGES[err.ref] ?? 'Algum dado não confere.';
        setError(err.ref, message);
        (form.elements.namedItem(err.ref) as HTMLElement | null)?.focus();
      } else if (err instanceof OrderError && err.kind === 'item') {
        notice.textContent = 'Um dos itens mudou no cardápio de festa. Recarregue a página e monte de novo.';
        notice.focus();
      } else if (err instanceof OrderError && err.kind === 'limite') {
        notice.textContent = 'Você já mandou várias encomendas agora há pouco. Espere alguns minutos antes de mandar outra.';
        notice.focus();
      } else {
        notice.textContent = 'Sem conexão com a padaria agora. Tente de novo em instantes.';
        notice.focus();
      }
    } finally {
      form.removeAttribute('aria-busy');
      submit.disabled = false;
    }
  });

  document.querySelector('[data-festa-nova]')?.addEventListener('click', () => {
    form.reset();
    KITS.forEach((k) => {
      qtd[k.id] = 0;
      renderKit(k.id);
    });
    renderTotals();
    done.hidden = true;
    form.hidden = false;
    $<HTMLButtonElement>('[data-kit] [data-step="1"]').focus();
  });

  KITS.forEach((k) => renderKit(k.id));
  renderTotals();
}
