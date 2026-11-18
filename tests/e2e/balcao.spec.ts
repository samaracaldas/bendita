import { expect, test } from '@playwright/test';

test('o balcão pede login e não fica no índice de busca', async ({ page }) => {
  await page.goto('/balcao');
  await expect(page.getByRole('heading', { name: 'Entrar no balcão' })).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Senha')).toHaveAttribute('type', 'password');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeHidden();
});
