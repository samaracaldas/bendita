import { defineConfig, devices } from '@playwright/test';

const PORT = 4334;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Animations are covered by one dedicated test; everywhere else they only add waiting.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  projects: [
    // Locally, reuse the installed Chrome instead of downloading a browser.
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: CI ? undefined : 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: CI ? undefined : 'chrome' } },
  ],
  webServer: {
    command: `npx astro build && npx astro preview --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    // A fake Supabase: the tests answer its requests with page.route (tests/e2e/fixtures.ts).
    env: {
      PUBLIC_SUPABASE_URL: 'http://supabase.test',
      PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
