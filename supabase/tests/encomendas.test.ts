import { beforeAll, describe, expect, it } from 'vitest';
import { KITS, TAXA_ENTREGA_FESTA, descricaoItem, totaisFesta, type ItemFesta } from '../../src/data/festa';
import { as, createDb, type Db } from './db';

let db: Db;
const STAFF = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  db = await createDb();
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, STRANGER]);
  await db.query(`insert into public.equipe (user_id, nome) values ($1, 'Balcão')`, [STAFF]);
}, 60_000);

/** A São Paulo date `days` from today, moved forward past Mondays when `skipMonday`. */
function diaSP(days: number, skipMonday = true) {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  while (skipMonday && d.getUTCDay() === 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nextMonday(minDays: number) {
  const d = new Date(`${diaSP(minDays, false)}T12:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Encomenda = { codigo: string; token: string; subtotal: number; taxa: number; total: number };

let nextIp = 1;
const encomendar = (itens: unknown[], over: Partial<Record<string, unknown>> = {}) => {
  const a = {
    nome: 'Lia',
    telefone: '(11) 98888-7777',
    data: diaSP(3),
    periodo: 'tarde',
    tipo: 'retirada',
    endereco: null,
    obs: null,
    ip: `10.9.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`,
    ...over,
  };
  return as(db, 'anon', null, async () => {
    await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': a.ip })]);
    try {
      return await db.query<{ e: Encomenda }>(
        `select public.criar_encomenda($1, $2, $3::date, $4, $5, $6, $7, $8::jsonb) as e`,
        [a.nome, a.telefone, a.data, a.periodo, a.tipo, a.endereco, a.obs, JSON.stringify(itens)],
      );
    } finally {
      await db.query(`select set_config('request.headers', '', false)`);
    }
  }).then((r) => r.rows[0].e);
};

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const err = e as { message: string; hint?: string };
    return { message: err.message, hint: err.hint };
  }
  throw new Error('expected an error');
};

describe('catálogo de festa', () => {
  it('kits e sabores do banco são os mesmos do site', async () => {
    const kits = await db.query<{ id: string; nome: string; preco: number; max_sabores: number }>(
      `select id, nome, preco, max_sabores from public.kits_festa order by ordem`,
    );
    expect(kits.rows).toEqual(KITS.map((k) => ({ id: k.id, nome: k.nome, preco: k.preco, max_sabores: k.maxSabores })));
    const sabores = await db.query<{ kit_id: string; id: string; nome: string }>(
      `select s.kit_id, s.id, s.nome from public.sabores_festa s join public.kits_festa k on k.id = s.kit_id
        order by k.ordem, s.ordem`,
    );
    expect(sabores.rows).toEqual(KITS.flatMap((k) => k.sabores.map((s) => ({ kit_id: k.id, id: s.id, nome: s.nome }))));
    const taxa = await db.query<{ valor: number }>(`select valor from public.parametros where chave = 'taxa_entrega_festa'`);
    expect(taxa.rows[0].valor).toBe(TAXA_ENTREGA_FESTA);
  });
});

describe('criar_encomenda', () => {
  it('calcula como o site, guarda a descrição e devolve o código', async () => {
    const itens: ItemFesta[] = [
      { kit: 'mini-sonhos', quantidade: 2, sabores: ['creme', 'doce-de-leite'] },
      { kit: 'salgados', quantidade: 1, sabores: ['esfiha', 'coxinha', 'risoles'] },
      { kit: 'pao-de-queijo', quantidade: 3, sabores: [] },
    ];
    const e = await encomendar(itens, { tipo: 'entrega', endereco: 'Rua Harmonia, 123' });
    expect(e.codigo).toMatch(/^F-\d{4}$/);
    expect(e).toMatchObject(totaisFesta(itens, 'entrega'));

    const salvos = await db.query<{ descricao: string; telefone: string }>(
      `select i.descricao, e.telefone from public.itens_encomenda i join public.encomendas e on e.id = i.encomenda_id
        where e.codigo = $1 order by i.id`,
      [e.codigo],
    );
    expect(salvos.rows.map((r) => r.descricao)).toEqual(itens.map(descricaoItem));
    expect(salvos.rows[0].telefone).toBe('11988887777');
  });

  it('exige antecedência, recusa segunda e datas longe demais', async () => {
    const kit = [{ kit: 'pao-de-queijo', quantidade: 1, sabores: [] }];
    for (const data of [diaSP(0, false), diaSP(1, false), nextMonday(2), diaSP(61, false)]) {
      expect(await errorOf(encomendar(kit, { data }))).toMatchObject({ message: 'dados_invalidos', hint: 'data' });
    }
    await expect(encomendar(kit, { data: diaSP(2) })).resolves.toMatchObject({ total: 6500 });
  });

  it('valida telefone, período, endereço e itens', async () => {
    const kit = [{ kit: 'pao-de-queijo', quantidade: 1, sabores: [] }];
    expect(await errorOf(encomendar(kit, { telefone: '1234' }))).toMatchObject({ hint: 'telefone' });
    expect(await errorOf(encomendar(kit, { periodo: 'noite' }))).toMatchObject({ hint: 'periodo' });
    expect(await errorOf(encomendar(kit, { tipo: 'entrega' }))).toMatchObject({ hint: 'endereco' });
    expect(await errorOf(encomendar([]))).toMatchObject({ hint: 'itens' });
    expect(await errorOf(encomendar([...kit, ...kit]))).toMatchObject({ hint: 'itens' });
  });

  it('recusa sabores e quantidades fora das regras do kit', async () => {
    const casos = [
      { kit: 'mini-sonhos', quantidade: 1, sabores: ['creme', 'goiabada', 'brigadeiro'] }, // mais de 2
      { kit: 'mini-sonhos', quantidade: 1, sabores: [] }, // precisa de 1
      { kit: 'docinhos', quantidade: 1, sabores: ['coxinha'] }, // sabor de outro kit
      { kit: 'docinhos', quantidade: 1, sabores: ['beijinho', 'beijinho'] },
      { kit: 'pao-de-queijo', quantidade: 1, sabores: ['creme'] }, // kit sem sabor
      { kit: 'salgados', quantidade: 11, sabores: ['coxinha'] },
      { kit: 'salgados', quantidade: 1.5, sabores: ['coxinha'] },
      { kit: 'bolo-de-casamento', quantidade: 1, sabores: [] },
    ];
    for (const item of casos) {
      expect(await errorOf(encomendar([item]))).toMatchObject({ message: 'item_invalido' });
    }
  });

  it('o mesmo aparelho só faz algumas encomendas por janela', async () => {
    const kit = [{ kit: 'pao-de-queijo', quantidade: 1, sabores: [] }];
    for (let i = 0; i < 3; i++) await encomendar(kit, { ip: '203.0.113.50' });
    expect(await errorOf(encomendar(kit, { ip: '203.0.113.50' }))).toMatchObject({ message: 'limite', hint: 'origem' });
  });
});

describe('permissões das encomendas', () => {
  it('só a equipe lê e muda o status; o valor não muda', async () => {
    const e = await encomendar([{ kit: 'docinhos', quantidade: 1, sabores: ['brigadeiro'] }]);

    for (const table of ['encomendas', 'itens_encomenda']) {
      const err = await errorOf(as(db, 'anon', null, () => db.query(`select * from public.${table}`)));
      expect(err.message).toMatch(/permission denied/);
    }
    const estranho = await as(db, 'authenticated', STRANGER, () => db.query(`select id from public.encomendas`));
    expect(estranho.rows).toEqual([]);

    await as(db, 'authenticated', STAFF, async () => {
      const { rows } = await db.query(`select codigo from public.encomendas where codigo = $1`, [e.codigo]);
      expect(rows).toHaveLength(1);
      await db.query(`update public.encomendas set status = 'confirmada' where codigo = $1`, [e.codigo]);
    });
    const err = await errorOf(
      as(db, 'authenticated', STAFF, () => db.query(`update public.encomendas set total = 1 where codigo = $1`, [e.codigo])),
    );
    expect(err.message).toMatch(/permission denied/);
  });
});
