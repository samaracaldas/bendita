/** The combo card: live price for the picked pair, and one click to put both in the bag. */
import { COMBO_DISCOUNT, formatBRL } from '../data/menu';
import { addLine, announce } from './shop';

const form = document.querySelector<HTMLFormElement>('[data-combo-form]');

if (form) {
  const sonho = form.querySelector<HTMLSelectElement>('[data-combo-sonho]')!;
  const cafe = form.querySelector<HTMLSelectElement>('[data-combo-cafe]')!;
  const priceOf = (s: HTMLSelectElement) => Number(s.selectedOptions[0].dataset.price);

  const paint = () => {
    const full = priceOf(sonho) + priceOf(cafe);
    form.querySelector('[data-combo-de]')!.textContent = formatBRL(full);
    form.querySelector('[data-combo-por]')!.textContent = formatBRL(full - COMBO_DISCOUNT);
  };
  sonho.addEventListener('change', paint);
  cafe.addEventListener('change', paint);
  paint();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const art = form.closest('[data-combo]')?.querySelector<SVGElement>('.art-sonho') ?? null;
    const okSonho = addLine(sonho.value, art);
    const okCafe = okSonho && addLine(cafe.value, null);
    if (okSonho && okCafe) {
      announce(`Combo na sacola: ${sonho.selectedOptions[0].text} e ${cafe.selectedOptions[0].text}.`, true);
    }
  });
}
