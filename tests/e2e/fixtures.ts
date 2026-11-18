import { test as base, type Page } from '@playwright/test';

export interface OrderBody {
  p_nome: string;
  p_tipo: 'retirada' | 'entrega';
  p_endereco: string | null;
  p_horario: string;
  p_obs: string | null;
  p_itens: { linha: string; quantidade: number }[];
}

export const TOKEN = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';

/** A stand-in for the Supabase RPCs the shop calls. */
export class FakeSupabase {
  /** Units left today per product; products not listed have plenty. */
  stock = new Map<string, number>();
  orders: OrderBody[] = [];
  /** Set to make the next criar_pedido fail like the database would. */
  nextError: { message: string; hint?: string; details?: string } | null = null;
  /** What acompanhar_pedido returns for TOKEN; change `status` to simulate the counter moving it along. */
  tracked = {
    codigo: 'B-4321',
    nome: 'Rui',
    tipo: 'retirada' as 'retirada' | 'entrega',
    horario: '2026-11-18T13:30:00+00:00',
    status: 'recebido',
    subtotal: 1900,
    taxa: 0,
    total: 1900,
    atualizado_em: '2026-11-18T12:00:00+00:00',
    itens: [
      { descricao: 'Sonho de doce de leite', quantidade: 2 },
    ],
  };
  trackCalls = 0;
  /** Bodies sent to criar_encomenda. */
  parties: Record<string, unknown>[] = [];

  async install(page: Page) {
    await page.route('http://supabase.test/rest/v1/rpc/estoque_do_dia', (route) =>
      route.fulfill({
        json: [...this.stock].map(([produto_id, restantes]) => ({ produto_id, restantes })),
      }),
    );
    await page.route('http://supabase.test/rest/v1/rpc/criar_pedido', (route) => {
      const body = route.request().postDataJSON() as OrderBody;
      if (this.nextError) {
        const error = this.nextError;
        this.nextError = null;
        return route.fulfill({ status: 400, json: { code: 'P0001', ...error } });
      }
      this.orders.push(body);
      return route.fulfill({
        json: {
          codigo: 'B-4321',
          token: TOKEN,
          subtotal: 1000,
          taxa: body.p_tipo === 'entrega' ? 700 : 0,
          total: 9999,
        },
      });
    });
    await page.route('http://supabase.test/rest/v1/rpc/criar_encomenda', (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (this.nextError) {
        const error = this.nextError;
        this.nextError = null;
        return route.fulfill({ status: 400, json: { code: 'P0001', ...error } });
      }
      this.parties.push(body);
      return route.fulfill({ json: { codigo: 'F-2468', subtotal: 41500, taxa: 0, total: 41500 } });
    });
    await page.route('http://supabase.test/rest/v1/rpc/acompanhar_pedido', (route) => {
      this.trackCalls++;
      const { p_token } = route.request().postDataJSON() as { p_token: string };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(p_token === TOKEN ? this.tracked : null) });
    });
  }
}

export const test = base.extend<{ supabase: FakeSupabase }>({
  // Auto: every test talks to the fake, even the ones that never look at it.
  supabase: [
    async ({ page }, use) => {
      const fake = new FakeSupabase();
      await fake.install(page);
      await use(fake);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
