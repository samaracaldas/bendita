import type { Page } from '@playwright/test';
import { MENU } from '../../src/data/menu';
import { expect, test } from './fixtures';

// Intl puts a non-breaking space after "R$".
const money = (value: string) => new RegExp(`R\\$\\s${value}`);

const addToBag = (page: Page, product: string) =>
  page.getByRole('button', { name: `Quero esse: ${product}` }).click();

const bagButton = (page: Page) => page.locator('[data-cart-open]');
const bag = (page: Page) => page.getByRole('dialog');

test.beforeEach(async ({ page, supabase }) => {
  supabase.stock.set('rosca-coco', 2);
  supabase.stock.set('pote-limao', 0);
  await page.goto('/');
});

test('adiciona, ajusta a quantidade e mantém a sacola depois de recarregar', async ({ page }) => {
  await addToBag(page, 'Sonho de creme');
  await addToBag(page, 'Sonho de creme');
  await expect(bagButton(page)).toContainText('2');
  await expect(page.locator('[data-product="sonho-creme"] [data-in-cart]')).toHaveText('2 na sacola');

  await bagButton(page).click();
  await expect(bag(page)).toBeVisible();
  await bag(page).getByRole('button', { name: 'Aumentar Sonho de creme' }).click();
  await expect(bag(page).locator('[data-line="sonho-creme"] [data-qty]')).toHaveText('3');
  await expect(bag(page).locator('[data-line="sonho-creme"] [data-line-total]')).toHaveText(money('25,50'));

  await page.reload();
  await expect(bagButton(page)).toContainText('3');
  await bagButton(page).click();
  await expect(bag(page).locator('[data-line="sonho-creme"] [data-qty]')).toHaveText('3');
});

test('finaliza um pedido de entrega e envia só linhas e quantidades', async ({ page, supabase }) => {
  await addToBag(page, 'Sonho de creme');
  await addToBag(page, 'Coxinha de frango');
  await bagButton(page).click();

  await bag(page).getByRole('radio', { name: /^Entrega/ }).check();
  // R$ 8,50 + R$ 8,00 + R$ 7,00 de entrega
  await expect(bag(page).locator('[data-fee]')).toHaveText(money('7,00'));
  await expect(bag(page).locator('[data-view="cart"] [data-total]')).toHaveText(money('23,50'));

  await bag(page).getByRole('button', { name: 'Continuar' }).click();
  await expect(bag(page).getByLabel('Nome para o pedido')).toBeFocused();

  // Empty form: every required field explains what is missing.
  await bag(page).getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(bag(page).getByText('Diga um nome para o pedido.')).toBeVisible();
  await expect(bag(page).getByText('Escolha um horário.')).toBeVisible();
  await expect(bag(page).getByText('Precisamos do endereço com número.')).toBeVisible();
  expect(supabase.orders).toHaveLength(0);

  await bag(page).getByLabel('Nome para o pedido').fill('Ana');
  await bag(page).getByLabel('Horário de entrega').selectOption({ index: 1 });
  await bag(page).getByLabel('Endereço de entrega').fill('Rua Fradique Coutinho, 900');
  await bag(page).getByRole('button', { name: 'Confirmar pedido' }).click();

  await expect(bag(page).getByText('Pedido B-4321')).toBeVisible();
  // The total shown is the one the database calculated, not the browser's.
  await expect(bag(page).getByText(/Ana, 2 itens saem para entrega .*R\$\s99,99/)).toBeVisible();
  await expect(bag(page).getByText('Nada foi cobrado agora', { exact: false })).toBeVisible();

  expect(supabase.orders).toHaveLength(1);
  const [order] = supabase.orders;
  expect(order).toMatchObject({ p_nome: 'Ana', p_tipo: 'entrega', p_endereco: 'Rua Fradique Coutinho, 900' });
  expect(order.p_horario).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|30):00-03:00$/);
  expect(order.p_itens).toEqual([
    { linha: 'sonho-creme', quantidade: 1 },
    { linha: 'coxinha', quantidade: 1 },
  ]);
  expect(JSON.stringify(order)).not.toContain('preco');

  await bag(page).getByRole('button', { name: 'Voltar para a vitrine' }).click();
  await expect(bag(page)).toBeHidden();
  await expect(bagButton(page)).toContainText('0');
});

test('mostra o estoque do dia e não deixa passar do que resta', async ({ page }) => {
  const rosca = page.locator('[data-product="rosca-coco"]');
  await expect(rosca.locator('[data-stock]')).toHaveText('Restam 2 hoje');

  const limao = page.locator('[data-product="pote-limao"]');
  await expect(limao.locator('[data-stock]')).toHaveText('Esgotado hoje');
  await expect(limao.getByRole('button', { name: 'Bolo de pote de limão: esgotado hoje' })).toBeDisabled();

  await addToBag(page, 'Rosca de coco');
  await addToBag(page, 'Rosca de coco');
  await addToBag(page, 'Rosca de coco');
  await expect(page.locator('[data-toast]')).toContainText('restam 2 de Rosca de coco hoje');
  await expect(bagButton(page)).toContainText('2');

  await bagButton(page).click();
  await expect(bag(page).getByRole('button', { name: 'Aumentar Rosca de coco' })).toBeDisabled();
});

test('se o produto esgotar no meio do pedido, volta para a sacola explicando', async ({ page, supabase }) => {
  await addToBag(page, 'Coxinha de frango');
  await addToBag(page, 'Coxinha de frango');
  await bagButton(page).click();
  await bag(page).getByRole('button', { name: 'Continuar' }).click();
  await bag(page).getByLabel('Nome para o pedido').fill('Ana');
  await bag(page).getByLabel('Horário de retirada').selectOption({ index: 1 });

  supabase.nextError = { message: 'esgotado', hint: 'coxinha', details: '1' };
  await bag(page).getByRole('button', { name: 'Confirmar pedido' }).click();

  const notice = bag(page).getByRole('alert');
  await expect(notice).toHaveText(/só resta 1 de Coxinha de frango/);
  await expect(notice).toBeFocused();
  await expect(bagButton(page)).toContainText('2'); // nothing was lost
});

test('remover o último item mostra a sacola vazia', async ({ page }) => {
  await addToBag(page, 'Pão de queijo');
  await bagButton(page).click();
  await bag(page).getByRole('button', { name: 'Remover Pão de queijo da sacola' }).click();

  await expect(bag(page).getByText('Sua sacola está vazia.')).toBeVisible();
  await expect(bagButton(page)).toContainText('0');
});

test('Esc fecha a sacola e devolve o foco ao botão', async ({ page }) => {
  await bagButton(page).click();
  await expect(bag(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bag(page)).toBeHidden();
  await expect(bagButton(page)).toBeFocused();
});

test('o filtro mostra só a categoria escolhida', async ({ page }) => {
  const cards = page.locator('#vitrine li[data-product]');
  await expect(cards).toHaveCount(MENU.length);

  await page.getByRole('button', { name: 'Salgados', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salgados', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.filter({ visible: true })).toHaveCount(MENU.filter((p) => p.category === 'salgados').length);

  await page.getByRole('button', { name: 'Tudo', exact: true }).click();
  await expect(cards.filter({ visible: true })).toHaveCount(MENU.length);
});

test.describe('com animações', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('o produto voa até a sacola e some ao chegar', async ({ page }) => {
    await addToBag(page, 'Coxinha de frango');
    const flying = page.locator('body > svg');
    await expect(flying).toHaveCount(1);
    await expect(flying).toHaveCount(0);
    await expect(bagButton(page)).toContainText('1');
  });
});

test('com movimento reduzido nada voa', async ({ page }) => {
  await addToBag(page, 'Coxinha de frango');
  await expect(page.locator('body > svg')).toHaveCount(0);
  await expect(bagButton(page)).toContainText('1');
});
