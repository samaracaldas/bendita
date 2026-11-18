import { expect, test } from './fixtures';

test('a página Sobre conta a história e leva de volta à loja', async ({ page }) => {
  await page.goto('/sobre');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Um sonho de família/);
  await expect(page.getByRole('heading', { name: 'Três regras da cozinha' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A turma da Bendita' })).toBeVisible();

  // The bag works here too.
  await page.locator('[data-cart-open]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('main').getByRole('link', { name: 'Ver a vitrine' }).click();
  await expect(page).toHaveURL(/\/#vitrine$/);
  await expect(page.getByRole('heading', { name: 'A vitrine de hoje' })).toBeVisible();
});

test('o combo da vitrine coloca sonho e café na sacola com desconto', async ({ page }) => {
  await page.goto('/#vitrine');
  const combo = page.locator('[data-combo]');
  await combo.getByLabel('Sonho').selectOption('sonho-goiabada');
  await combo.getByLabel('Café').selectOption('cappuccino');
  // 9,00 + 12,00 − 2,00
  await expect(combo.locator('[data-combo-por]')).toHaveText(/R\$\s19,00/);
  await combo.getByRole('button', { name: 'Quero o combo' }).click();

  await page.locator('[data-cart-open]').click();
  const bag = page.getByRole('dialog');
  await expect(bag.locator('[data-line="sonho-goiabada"]')).toBeVisible();
  await expect(bag.locator('[data-line="cappuccino"]')).toBeVisible();
  await expect(bag.locator('[data-combo-row]')).toContainText(/− R\$\s2,00/);
});
