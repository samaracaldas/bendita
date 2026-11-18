import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const festa = (page: Page) => page.locator('#festa');
const money = (value: string) => new RegExp(`R\\$\\s${value}`);

/** A São Paulo date `days` ahead that isn't a Monday. */
function diaValido(days: number) {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  while (d.getUTCDay() === 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#festa');
});

test('monta uma encomenda de festa e envia kits, sabores e contato', async ({ page, supabase }) => {
  const f = festa(page);
  await f.getByRole('button', { name: 'Um cento a mais de Mini sonhos' }).click();
  await f.getByRole('button', { name: 'Um cento a mais de Mini sonhos' }).click();
  // Two flavors is the limit for mini sonhos: the others get disabled.
  await f.locator('[data-kit="mini-sonhos"]').getByRole('checkbox', { name: 'goiabada' }).check();
  await expect(f.locator('[data-kit="mini-sonhos"]').getByRole('checkbox', { name: 'creme' })).toBeDisabled();

  await f.getByRole('button', { name: 'Um cento a mais de Salgados mistos' }).click();
  await f.locator('[data-kit="salgados"]').getByRole('checkbox', { name: 'mini esfiha' }).check();

  // 2 × 160 + 95 = 415
  await expect(f.locator('[data-festa-total]')).toHaveText(money('415,00'));

  await f.getByLabel('Dia da festa').fill(diaValido(5));
  await f.getByLabel('Período').selectOption('manha');
  await f.getByLabel('Seu nome').fill('Lia');
  await f.getByLabel('WhatsApp com DDD').fill('(11) 98888-7777');
  await f.getByRole('button', { name: 'Enviar encomenda' }).click();

  await expect(f.getByText('Encomenda F-2468')).toBeVisible();
  expect(supabase.parties).toHaveLength(1);
  expect(supabase.parties[0]).toMatchObject({
    p_nome: 'Lia',
    p_telefone: '11988887777',
    p_periodo: 'manha',
    p_tipo: 'retirada',
    p_itens: [
      { kit: 'salgados', quantidade: 1, sabores: ['coxinha', 'esfiha'] },
      { kit: 'mini-sonhos', quantidade: 2, sabores: ['doce-de-leite', 'goiabada'] },
    ],
  });
});

test('explica o que falta antes de enviar', async ({ page, supabase }) => {
  const f = festa(page);
  await f.getByRole('button', { name: 'Enviar encomenda' }).click();
  await expect(f.getByText('Escolha pelo menos um cento.')).toBeVisible();
  await expect(f.getByText('Escolha o dia da festa.')).toBeVisible();
  await expect(f.getByText('Precisamos de um WhatsApp com DDD', { exact: false })).toBeVisible();

  await f.getByRole('button', { name: 'Um cento a mais de Pão de queijo coquetel' }).click();
  await f.getByLabel('Dia da festa').fill(diaValido(0));
  await f.getByRole('button', { name: 'Enviar encomenda' }).click();
  await expect(f.getByText('Precisamos de pelo menos 2 dias de antecedência.')).toBeVisible();
  expect(supabase.parties).toHaveLength(0);
});
