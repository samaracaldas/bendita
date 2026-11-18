import { formatBRL } from '../data/menu';
import {
  SONHO_MONTADO_ID,
  opcao,
  sonhoDescricao,
  sonhoKey,
  sonhoPreco,
  type SonhoConfig,
} from '../data/sonho';
import { addLine, cart, inBag, onStock, remaining, room } from './shop';

const form = document.querySelector<HTMLFormElement>('[data-montador]');

if (form) {
  const preview = document.querySelector<SVGSVGElement>('[data-preview]')!;
  const q = <T extends Element>(sel: string) => form.querySelector<T>(sel)!;
  const recheioInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="recheio"]'));
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  const read = (): SonhoConfig => {
    const data = new FormData(form);
    const recheios = data.getAll('recheio').map(String).sort();
    return {
      massa: String(data.get('massa')),
      recheios: recheios as SonhoConfig['recheios'],
      cobertura: String(data.get('cobertura')),
    };
  };

  // SVG elements are hidden with the display attribute, not `hidden`.
  const show = (el: Element, on: boolean) => el.setAttribute('display', on ? 'inline' : 'none');

  function paint(c: SonhoConfig) {
    const massa = opcao(c.massa)!.cor;
    preview.querySelectorAll('[data-massa]').forEach((el) => el.setAttribute('fill', massa));

    const [a, b] = c.recheios;
    const half = preview.querySelector<SVGPathElement>('[data-recheio-a]')!;
    half.setAttribute('fill', opcao(a)!.cor);
    if (b) half.setAttribute('clip-path', 'url(#metade-a)');
    else half.removeAttribute('clip-path');
    const other = preview.querySelector<SVGPathElement>('[data-recheio-b]')!;
    show(other, !!b);
    if (b) other.setAttribute('fill', opcao(b)!.cor);
    show(preview.querySelector('[data-divisa]')!, !!b);

    preview.querySelectorAll<SVGGElement>('[data-cobertura]').forEach((g) => {
      show(g, g.dataset.cobertura === c.cobertura);
    });
  }

  function update(changed = true) {
    const c = read();
    // At most two fillings: the rest is disabled until one is unchecked.
    recheioInputs.forEach((i) => (i.disabled = !i.checked && c.recheios.length >= 2));

    paint(c);
    q('[data-montador-desc]').textContent = sonhoDescricao(c);
    q('[data-montador-price]').textContent = formatBRL(sonhoPreco(c));

    const key = sonhoKey(c);
    const left = remaining(SONHO_MONTADO_ID) - inBag(SONHO_MONTADO_ID);
    const note = q<HTMLElement>('[data-montador-stock]');
    const finite = Number.isFinite(left);
    note.hidden = !finite || left > 10;
    note.textContent =
      left <= 0
        ? remaining(SONHO_MONTADO_ID) === 0
          ? 'Os sonhos montados esgotaram por hoje.'
          : 'Todos os sonhos montados de hoje já estão na sua sacola.'
        : `Só ${left === 1 ? 'resta 1 sonho montado' : `restam ${left} sonhos montados`} hoje.`;
    q<HTMLButtonElement>('[data-montador-add]').disabled = room(key) <= 0;

    if (changed && !calm.matches) {
      preview.classList.remove('wiggle');
      void preview.getBoundingClientRect();
      preview.classList.add('wiggle');
    }
  }

  form.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    // Never zero fillings: unchecking the last one puts it back.
    if (input.name === 'recheio' && !recheioInputs.some((i) => i.checked)) input.checked = true;
    update();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addLine(sonhoKey(read()), preview);
    update(false);
  });

  cart.subscribe(() => update(false));
  onStock(() => update(false));
}
