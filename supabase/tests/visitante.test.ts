import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, nextSlot, type Db } from './db';

let db: Db;
const STAFF = '11111111-1111-1111-1111-111111111111';
const VISITOR = '33333333-3333-3333-3333-333333333333';
let codigo = '';
let encomenda = '';

beforeAll(async () => {
  db = await createDb();
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, VISITOR]);
  await db.query(`insert into public.equipe (user_id, nome) values ($1, 'Balcão')`, [STAFF]);
  await db.query(`insert into public.equipe (user_id, nome, papel) values ($1, 'Visitante', 'visitante')`, [VISITOR]);

  const pedido = await as(db, 'anon', null, () =>
    db.query<{ p: { codigo: string } }>(
      `select public.criar_pedido('Ana', 'retirada', null, $1, null, '[{"linha":"coxinha","quantidade":1}]'::jsonb) as p`,
      [nextSlot()],
    ),
  );
  codigo = pedido.rows[0].p.codigo;

  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  if (d.getUTCDay() === 1) d.setUTCDate(d.getUTCDate() + 1);
  const festa = await as(db, 'anon', null, () =>
    db.query<{ e: { codigo: string } }>(
      `select public.criar_encomenda('Lia', '11988887777', $1::date, 'tarde', 'retirada', null, null,
         '[{"kit":"pao-de-queijo","quantidade":1,"sabores":[]}]'::jsonb) as e`,
      [d.toISOString().slice(0, 10)],
    ),
  );
  encomenda = festa.rows[0].e.codigo;
}, 60_000);

const status = (table: 'pedidos' | 'encomendas', code: string) =>
  db.query<{ status: string }>(`select status from public.${table} where codigo = $1`, [code]).then((r) => r.rows[0].status);

describe('visitante do balcão', () => {
  it('vê pedidos, encomendas e estoque como a equipe', async () => {
    await as(db, 'authenticated', VISITOR, async () => {
      expect((await db.query(`select 1 from public.pedidos where codigo = $1`, [codigo])).rows).toHaveLength(1);
      expect((await db.query(`select 1 from public.encomendas where codigo = $1`, [encomenda])).rows).toHaveLength(1);
      expect((await db.query(`select 1 from public.estoque`)).rows.length).toBeGreaterThan(0);
      const papel = await db.query<{ p: string }>(`select public.papel_atual() as p`);
      expect(papel.rows[0].p).toBe('visitante');
    });
  });

  it('não muda status de pedido nem de encomenda', async () => {
    await as(db, 'authenticated', VISITOR, async () => {
      await db.query(`update public.pedidos set status = 'cancelado' where codigo = $1`, [codigo]);
      await db.query(`update public.encomendas set status = 'cancelada' where codigo = $1`, [encomenda]);
    });
    expect(await status('pedidos', codigo)).toBe('recebido');
    expect(await status('encomendas', encomenda)).toBe('nova');
  });

  it('não ajusta o estoque', async () => {
    let message = '';
    try {
      await as(db, 'authenticated', VISITOR, () =>
        db.query(`select public.ajustar_estoque('coxinha', current_date, 99)`),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('sem_permissao');
  });

  it('a equipe continua podendo mudar tudo', async () => {
    await as(db, 'authenticated', STAFF, async () => {
      await db.query(`update public.pedidos set status = 'separado' where codigo = $1`, [codigo]);
      await db.query(`update public.encomendas set status = 'confirmada' where codigo = $1`, [encomenda]);
      const papel = await db.query<{ p: string }>(`select public.papel_atual() as p`);
      expect(papel.rows[0].p).toBe('equipe');
    });
    expect(await status('pedidos', codigo)).toBe('separado');
    expect(await status('encomendas', encomenda)).toBe('confirmada');
  });
});
