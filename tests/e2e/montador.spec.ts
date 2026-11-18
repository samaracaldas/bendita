import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/#monte');
});

test('monta um sonho meio a meio, com preço e descrição ao vivo', async ({ page }) => {
  const monte = page.locator('#monte');
  await expect(monte.locator('[data-montador-price]')).toHaveText(/R\$\s9,00/);

  await monte.getByRole('radio', { name: /^Brioche/ }).check();
  await monte.getByRole('checkbox', { name: /^Goiabada/ }).check();
  await monte.getByRole('radio', { name: /^Granulado/ }).check();

  // 9,00 + 1,00 brioche + 0,50 granulado + 1,00 meio a meio
  await expect(monte.locator('[data-montador-price]')).toHaveText(/R\$\s11,50/);
  await expect(monte.locator('[data-montador-desc]')).toHaveText(
    'Meio a meio: doce de leite e goiabada, massa brioche, cobertura de granulado',
  );

  // Two fillings is the limit; the third choice is disabled until one is removed.
  await expect(monte.getByRole('checkbox', { name: /^Brigadeiro/ })).toBeDisabled();
  await monte.getByRole('checkbox', { name: /^Doce de leite/ }).uncheck();
  await expect(monte.getByRole('checkbox', { name: /^Brigadeiro/ })).toBeEnabled();
  await monte.getByRole('checkbox', { name: /^Doce de leite/ }).check();
});

test('o último recheio não pode ser desmarcado', async ({ page }) => {
  const doceDeLeite = page.locator('#monte').getByRole('checkbox', { name: /^Doce de leite/ });
  await doceDeLeite.uncheck({ force: true }).catch(() => {});
  await expect(doceDeLeite).toBeChecked();
});

test('o sonho montado vai para a sacola e para o pedido', async ({ page, supabase }) => {
  const monte = page.locator('#monte');
  await monte.getByRole('checkbox', { name: /^Creme de avelã/ }).check();
  await monte.getByRole('button', { name: 'Adicionar à sacola' }).click();
  await monte.getByRole('button', { name: 'Adicionar à sacola' }).click();

  await page.locator('[data-cart-open]').click();
  const line = page.getByRole('dialog').locator('[data-line="montado|tradicional|avela+doce-de-leite|acucar"]');
  await expect(line.locator('[data-name]')).toHaveText('Sonho do seu jeito');
  await expect(line.locator('[data-qty]')).toHaveText('2');
  // 9,00 + 2,00 avelã + 1,00 meio a meio = 12,00 × 2
  await expect(line.locator('[data-line-total]')).toHaveText(/R\$\s24,00/);

  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nome para o pedido').fill('Rui');
  await page.getByLabel('Horário de retirada').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(page.getByRole('dialog').getByText('Pedido B-4321')).toBeVisible();
  expect(supabase.orders[0].p_itens).toEqual([
    { linha: 'montado|tradicional|avela+doce-de-leite|acucar', quantidade: 2 },
  ]);
});

test('respeita o estoque de sonhos montados', async ({ page, supabase }) => {
  supabase.stock.set('sonho-montado', 1);
  await page.reload();
  const monte = page.locator('#monte');
  await expect(monte.locator('[data-montador-stock]')).toHaveText('Só resta 1 sonho montado hoje.');
  await monte.getByRole('button', { name: 'Adicionar à sacola' }).click();
  await expect(monte.getByRole('button', { name: 'Adicionar à sacola' })).toBeDisabled();
  await expect(monte.locator('[data-montador-stock]')).toHaveText(
    'Todos os sonhos montados de hoje já estão na sua sacola.',
  );
});
