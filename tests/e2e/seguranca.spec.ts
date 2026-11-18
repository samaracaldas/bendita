import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * `astro preview` ignores vercel.json, so these tests add its headers to every page
 * and fail on any Content-Security-Policy violation. The fake Supabase lives at
 * http://supabase.test, which is added to connect-src only here.
 */
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const global = config.headers.find((h) => h.source === '/(.*)')!.headers;
const headers = Object.fromEntries(
  global.map(({ key, value }) => [
    key,
    key === 'Content-Security-Policy'
      ? value.replace("connect-src 'self'", "connect-src 'self' http://supabase.test").replace('; upgrade-insecure-requests', '')
      : value,
  ]),
);

async function withHeaders(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('pageerror', (e) => violations.push(e.message));
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...headers } });
  });
  return violations;
}

test('a loja funciona com a política de segurança ligada', async ({ page }) => {
  const violations = await withHeaders(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quero esse: Sonho de creme' }).click();
  await page.locator('[data-combo]').getByRole('button', { name: 'Quero o combo' }).click();
  await page.locator('[data-cart-open]').click();
  await expect(page.getByRole('dialog').locator('[data-combo-row]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#festa').getByRole('button', { name: 'Um cento a mais de Mini sonhos' }).click();
  await page.locator('#monte').getByRole('checkbox', { name: /^Goiabada/ }).check();
  expect(violations).toEqual([]);
});

test('as outras páginas também', async ({ page }) => {
  const violations = await withHeaders(page);
  for (const path of ['/sobre', '/pedido?t=6f1c2d3e-4a5b-4c6d-8e7f-901234567890', '/balcao']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByRole('heading', { name: 'Entrar no balcão' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('o site não pode ser aberto dentro de outro site', () => {
  expect(headers['X-Frame-Options']).toBe('DENY');
  expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  expect(headers['Content-Security-Policy']).toContain("script-src 'self';");
});
