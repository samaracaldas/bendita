import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, nextSlot, type Db } from './db';

let db: Db;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

const semear = () =>
  db.query<{ r: { dia: string; pedidos: number; encomendas: number } }>(`select public.semear_demonstracao() as r`)
    .then((x) => x.rows[0].r);

/** Units reserved per product and day vs. units in non-cancelled demo orders: must match. */
const reservas = async () => {
  const { rows } = await db.query<{ produto_id: string; dia: string; reservado: number; pedidos: number }>(`
    select e.produto_id, e.dia::text, e.reservado,
           coalesce((select sum(i.quantidade) from public.itens_pedido i join public.pedidos p on p.id = i.pedido_id
                      where i.produto_id = e.produto_id and p.status <> 'cancelado'
                        and (p.horario at time zone 'America/Sao_Paulo')::date = e.dia), 0)::int as pedidos
      from public.estoque e`);
  return rows;
};

describe('semear_demonstracao', () => {
  it('cria um dia de pedidos com status variados e encomendas de festa', async () => {
    const r = await semear();
    expect(r).toMatchObject({ pedidos: 13, encomendas: 3 });

    const status = await db.query<{ status: string; n: number }>(
      `select status::text, count(*)::int as n from public.pedidos where demo group by 1 order by 1`,
    );
    expect(status.rows.map((s) => s.status)).toEqual(['cancelado', 'entregue', 'pronto', 'recebido', 'separado']);

    // Totals follow the same rules as real orders (combo discount, delivery fee).
    const julia = await db.query<{ subtotal: number; desconto: number; total: number }>(
      `select subtotal, desconto, total from public.pedidos where nome = 'Júlia Andrade'`,
    );
    // 2 × (900 + 100 brioche + 100 meio a meio) + 2 × 1200 cappuccino, two combos.
    expect(julia.rows[0]).toEqual({ subtotal: 4600, desconto: 400, total: 4200 });
  });

  it('reserva o estoque dos exemplos e devolve tudo ao semear de novo', async () => {
    await semear();
    await semear();
    for (const r of await reservas()) expect(r.reservado, r.produto_id).toBe(r.pedidos);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.pedidos where demo`);
    expect(rows[0].n).toBe(13);
  });

  it('não mexe em pedidos de verdade e não trava o limite de pedidos da loja', async () => {
    const real = await as(db, 'anon', null, async () => {
      await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '10.1.1.1' })]);
      return db.query<{ p: { codigo: string } }>(
        `select public.criar_pedido('Cliente', 'retirada', null, $1, null, '[{"linha":"coxinha","quantidade":1}]'::jsonb) as p`,
        [nextSlot()],
      );
    });
    await semear();
    const { rows } = await db.query(`select 1 from public.pedidos where codigo = $1 and not demo`, [real.rows[0].p.codigo]);
    expect(rows).toHaveLength(1);
  });

  it('o público não chama a função', async () => {
    let message = '';
    try {
      await as(db, 'anon', null, () => db.query(`select public.semear_demonstracao()`));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/permission denied/);
  });
});
