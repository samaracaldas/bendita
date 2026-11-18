import { expect, test, TOKEN } from './fixtures';

const bag = (page: import('@playwright/test').Page) => page.getByRole('dialog');

async function placeOrder(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quero esse: Sonho de doce de leite' }).click();
  await page.locator('[data-cart-open]').click();
  await bag(page).getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nome para o pedido').fill('Rui');
  await page.getByLabel('Horário de retirada').selectOption({ index: 1 });
  await bag(page).getByRole('button', { name: 'Confirmar pedido' }).click();
}

test('depois do pedido, o link leva ao acompanhamento e fica no topo da loja', async ({ page }) => {
  await placeOrder(page);
  const track = bag(page).getByRole('link', { name: 'Acompanhar pedido' });
  await expect(track).toHaveAttribute('href', `/pedido?t=${TOKEN}`);

  await bag(page).getByRole('button', { name: 'Voltar para a vitrine' }).click();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Acompanhar o pedido B-4321' })).toHaveAttribute(
    'href',
    `/pedido?t=${TOKEN}`,
  );

  await page.getByRole('link', { name: 'Acompanhar o pedido B-4321' }).click();
  await expect(page).toHaveURL(/\/pedido\?t=/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recebemos seu pedido, Rui.');
});

test('mostra o andamento e se atualiza sozinho', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-11-18T12:00:00-03:00') });
  await page.goto(`/pedido?t=${TOKEN}`);

  await expect(page.getByText('Pedido B-4321')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recebemos seu pedido, Rui.');
  const steps = page.getByRole('list', { name: 'Andamento do pedido' }).getByRole('listitem');
  await expect(steps).toHaveText(['Recebido', 'Separando', 'Pronto para retirar', 'Retirado']);
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('Hoje, 10h30')).toBeVisible();
  await expect(page.getByText('2× Sonho de doce de leite')).toBeVisible();

  supabase.tracked.status = 'pronto';
  await page.clock.runFor(15_000);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pronto! Pode vir buscar.');
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');

  // Finished orders stop polling.
  supabase.tracked.status = 'entregue';
  await page.clock.runFor(15_000);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Retirado. Bom apetite!');
  const calls = supabase.trackCalls;
  await page.clock.runFor(60_000);
  expect(supabase.trackCalls).toBe(calls);
});

test('link incompleto ou desconhecido explica o que fazer', async ({ page }) => {
  await page.goto('/pedido?t=00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Não achamos esse pedido');
  await page.goto('/pedido');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nenhum pedido aqui');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test('quando a padaria recusa por excesso de pedidos, a sacola explica e continua salva', async ({
  page,
  supabase,
}) => {
  supabase.nextError = { message: 'limite', hint: 'origem' };
  await placeOrder(page);
  await expect(bag(page).getByRole('alert')).toHaveText(/vários pedidos nos últimos minutos/);
  await expect(bag(page).locator('[data-line="sonho-doce-de-leite"]')).toBeVisible();
});
