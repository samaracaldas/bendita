import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const money = (value: string) => new RegExp(`R\\$\\s${value}`);
const add = (page: Page, product: string) => page.getByRole('button', { name: `Quero esse: ${product}` }).click();
const bag = (page: Page) => page.getByRole('dialog');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('o filtro Bebidas mostra só as bebidas, com a regra de retirada e o combo', async ({ page }) => {
  await page.getByRole('button', { name: 'Bebidas', exact: true }).click();
  const cards = page.locator('#vitrine [data-product]:visible');
  await expect(cards).toHaveCount(4);
  const cafe = page.locator('[data-product="cafe-coado"]');
  await expect(cafe).toContainText('Só para retirar no balcão');
  await expect(cafe).toContainText(/− R\$\s2,00 no combo com sonho/);
  await expect(page.locator('[data-product="achocolatado-gelado"]')).not.toContainText('combo com sonho');
});

test('sonho + café ganha o desconto do combo e o banco recebe só as linhas', async ({ page, supabase }) => {
  await add(page, 'Sonho de creme');
  await add(page, 'Café coado');
  await page.locator('[data-cart-open]').click();

  const combo = bag(page).locator('[data-combo-row]');
  await expect(combo).toBeVisible();
  await expect(combo).toContainText(/− R\$\s2,00/);
  // 8,50 + 6,00 − 2,00
  await expect(bag(page).locator('[data-view="cart"] [data-total]')).toHaveText(money('12,50'));

  await bag(page).getByRole('button', { name: 'Continuar' }).click();
  await bag(page).getByLabel('Nome para o pedido').fill('Bia');
  await bag(page).getByLabel('Horário de retirada').selectOption({ index: 1 });
  await bag(page).getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(bag(page).getByText('Pedido B-4321')).toBeVisible();
  expect(supabase.orders[0].p_itens).toEqual([
    { linha: 'sonho-creme', quantidade: 1 },
    { linha: 'cafe-coado', quantidade: 1 },
  ]);
});

test('bebida com entrega: avisa e segura o pedido até resolver', async ({ page }) => {
  await add(page, 'Coxinha de frango');
  await add(page, 'Pingado');
  await page.locator('[data-cart-open]').click();

  await bag(page).getByRole('radio', { name: /^Entrega/ }).check();
  const note = bag(page).locator('[data-pickup-note]');
  await expect(note).toHaveText(/Pingado é só para retirar no balcão/);
  const go = bag(page).getByRole('button', { name: 'Continuar' });
  await expect(go).toBeDisabled();
  await expect(go).toHaveAccessibleDescription(/só para retirar/);

  // Taking the drink out frees the order.
  await bag(page).getByRole('button', { name: 'Remover Pingado da sacola' }).click();
  await expect(note).toBeHidden();
  await expect(go).toBeEnabled();
});

test('se o banco recusar bebida na entrega, a sacola volta para retirada', async ({ page, supabase }) => {
  supabase.nextError = { message: 'so_retirada', hint: 'pingado' };
  await add(page, 'Coxinha de frango');
  await page.locator('[data-cart-open]').click();
  await bag(page).getByRole('button', { name: 'Continuar' }).click();
  await bag(page).getByLabel('Nome para o pedido').fill('Bia');
  await bag(page).getByLabel('Horário de retirada').selectOption({ index: 1 });
  await bag(page).getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(bag(page).getByRole('alert')).toHaveText(/Bebida é só para retirar no balcão/);
  await expect(bag(page).getByRole('radio', { name: /^Retirar no balcão/ })).toBeChecked();
});
