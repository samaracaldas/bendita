import { beforeAll, describe, expect, it } from 'vitest';
import { resolveLine } from '../../src/data/catalog';
import { ANTECEDENCIA_DIAS, ATE_DIAS, MAX_CENTOS, TAXA_ENTREGA_FESTA } from '../../src/data/festa';
import { COMBO_DISCOUNT, DELIVERY_FEE, MENU } from '../../src/data/menu';
import { cartTotals } from '../../src/scripts/cart-math';
import {
  MEIO_A_MEIO,
  OPCOES,
  SONHO_BASE,
  opcoesDo,
  sonhoKey,
  sonhoPreco,
  type SonhoConfig,
} from '../../src/data/sonho';
import { as, createDb, nextSlot, type Db } from './db';

let db: Db;
const STAFF = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  db = await createDb();
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, STRANGER]);
  await db.query(`insert into public.equipe (user_id, nome) values ($1, 'Balcão')`, [STAFF]);
}, 60_000);

type Item = { linha: string; quantidade: number };
type Pedido = { codigo: string; token: string; subtotal: number; desconto: number; taxa: number; total: number };

/** Each order comes from a new IP unless `ip` says otherwise, so the per-origin limit stays out of the way. */
let nextIp = 1;
const order = (itens: Item[], over: Partial<Record<string, unknown>> = {}) => {
  const args = {
    nome: 'Ana',
    tipo: 'retirada',
    endereco: null,
    horario: nextSlot(),
    obs: null,
    ip: `10.0.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`,
    ...over,
  };
  return as(db, 'anon', null, async () => {
    await db.query(`select set_config('request.headers', $1, false)`, [
      JSON.stringify({ 'x-forwarded-for': `${args.ip}, 172.16.0.1` }),
    ]);
    try {
      return await db.query<{ pedido: Pedido }>(
        `select public.criar_pedido($1, $2, $3, $4, $5, $6::jsonb) as pedido`,
        [args.nome, args.tipo, args.endereco, args.horario, args.obs, JSON.stringify(itens)],
      );
    } finally {
      await db.query(`select set_config('request.headers', '', false)`);
    }
  }).then((r) => r.rows[0].pedido);
};

const acompanhar = (token: string) =>
  as(db, 'anon', null, () =>
    db.query<{ p: Record<string, unknown> | null }>(`select public.acompanhar_pedido($1::uuid) as p`, [token]),
  ).then((r) => r.rows[0].p);

/** Runs `fn` with a different value for one of the limit parameters. */
const comParametro = async <T>(chave: string, valor: number, fn: () => Promise<T>) => {
  const { rows } = await db.query<{ valor: number }>(`select valor from public.parametros where chave = $1`, [chave]);
  await db.query(`update public.parametros set valor = $2 where chave = $1`, [chave, valor]);
  try {
    return await fn();
  } finally {
    await db.query(`update public.parametros set valor = $2 where chave = $1`, [chave, rows[0].valor]);
  }
};

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const err = e as { message: string; hint?: string; detail?: string };
    return { message: err.message, hint: err.hint, detail: err.detail };
  }
  throw new Error('expected an error');
};

const restantes = async (produto: string, horario = nextSlot()) => {
  const dia = horario.slice(0, 10);
  const r = await as(db, 'anon', null, () =>
    db.query<{ restantes: number }>(`select restantes from public.estoque_do_dia($1) where produto_id = $2`, [dia, produto]),
  );
  return r.rows[0].restantes;
};

describe('dados iniciais', () => {
  it('o cardápio do banco é o mesmo do site', async () => {
    const { rows } = await db.query<{ id: string; nome: string; preco: number }>(
      `select id, nome, preco from public.produtos where id <> 'sonho-montado' and ativo order by id`,
    );
    const site = MENU.map((p) => ({ id: p.id, nome: p.name, preco: p.price })).sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    expect(rows).toEqual(site);
  });

  it('as opções do sonho e os parâmetros são os mesmos do site', async () => {
    const { rows } = await db.query<{ id: string; grupo: string; nome: string; acrescimo: number }>(
      `select id, grupo, nome, acrescimo from public.opcoes_sonho`,
    );
    const site = OPCOES.map(({ id, grupo, nome, acrescimo }) => ({ id, grupo, nome, acrescimo }));
    expect(rows).toEqual(expect.arrayContaining(site));
    expect(rows).toHaveLength(site.length);

    const params = await db.query<{ chave: string; valor: number }>(`select chave, valor from public.parametros`);
    expect(Object.fromEntries(params.rows.map((r) => [r.chave, r.valor]))).toEqual({
      sonho_base: SONHO_BASE,
      meio_a_meio: MEIO_A_MEIO,
      taxa_entrega: DELIVERY_FEE,
      janela_minutos: 10,
      pedidos_por_origem: 3,
      pedidos_por_janela: 30,
      max_unidades: 60,
      desconto_combo: COMBO_DISCOUNT,
      taxa_entrega_festa: TAXA_ENTREGA_FESTA,
      max_centos: MAX_CENTOS,
      antecedencia_dias: ANTECEDENCIA_DIAS,
      ate_dias: ATE_DIAS,
    });
  });

  it('bebidas só na retirada e papéis do combo são os mesmos do site', async () => {
    const { rows } = await db.query<{ id: string; so_retirada: boolean; combo: string | null }>(
      `select id, so_retirada, combo from public.produtos where id <> 'sonho-montado' and ativo order by id`,
    );
    const site = MENU.map((p) => ({ id: p.id, so_retirada: p.pickupOnly ?? false, combo: p.combo ?? null })).sort(
      (a, b) => (a.id < b.id ? -1 : 1),
    );
    expect(rows).toEqual(site);
    const montado = await db.query<{ combo: string }>(`select combo from public.produtos where id = 'sonho-montado'`);
    expect(montado.rows[0].combo).toBe(resolveLine('montado|tradicional|creme|acucar')!.combo);
  });
});

describe('resolver_linha', () => {
  it('calcula o mesmo preço do site para todas as combinações de sonho', async () => {
    const recheios = opcoesDo('recheio').map((o) => o.id);
    const combos: SonhoConfig['recheios'][] = [
      ...recheios.map((r) => [r] as [string]),
      ...recheios.flatMap((a, i) => recheios.slice(i + 1).map((b) => [a, b] as [string, string])),
    ];
    const configs: SonhoConfig[] = opcoesDo('massa').flatMap((m) =>
      combos.flatMap((r) => opcoesDo('cobertura').map((c) => ({ massa: m.id, recheios: r, cobertura: c.id }))),
    );
    expect(configs).toHaveLength(2 * 21 * 4);

    const keys = configs.map(sonhoKey);
    const { rows } = await db.query<{ linha: string; preco: number }>(
      `select k as linha, (select preco from public.resolver_linha(k)) as preco from unnest($1::text[]) k`,
      [keys],
    );
    expect(rows.map((r) => r.preco)).toEqual(configs.map(sonhoPreco));
  });

  it('recusa linhas que o site também recusa', async () => {
    const invalid = [
      'bolo-de-festa',
      'montado|tradicional|goiabada+creme|acucar', // fora de ordem
      'montado|tradicional|creme+creme|acucar',
      'montado|tradicional|creme+goiabada+avela|acucar',
      'montado|tradicional|chocolate|acucar',
      'montado|creme|creme|acucar', // recheio no lugar da massa
      'montado|tradicional||acucar',
      'montado|tradicional|creme',
    ];
    const { rows } = await db.query<{ linha: string; n: number }>(
      `select k as linha, (select count(*) from public.resolver_linha(k))::int as n from unnest($1::text[]) k`,
      [invalid],
    );
    expect(rows.filter((r) => r.n > 0)).toEqual([]);
  });
});

describe('horario_valido', () => {
  // Terça, 17/11/2026, 12h10 em São Paulo.
  const agora = '2026-11-17T12:10:00-03:00';
  const ok = (h: string) =>
    db
      .query<{ ok: boolean }>(`select public.horario_valido($1::timestamptz, $2::timestamptz) as ok`, [h, agora])
      .then((r) => r.rows[0].ok);

  it('aceita horários de meia em meia hora com 30 minutos de antecedência', async () => {
    expect(await ok('2026-11-17T13:00:00-03:00')).toBe(true);
    expect(await ok('2026-11-17T20:00:00-03:00')).toBe(true);
    expect(await ok('2026-11-21T21:00:00-03:00')).toBe(true); // sábado
  });

  it('recusa horários fora das regras', async () => {
    expect(await ok('2026-11-17T12:30:00-03:00')).toBe(false); // antecedência
    expect(await ok('2026-11-17T13:15:00-03:00')).toBe(false); // não é :00 nem :30
    expect(await ok('2026-11-17T20:30:00-03:00')).toBe(false); // depois de fechar
    expect(await ok('2026-11-18T07:00:00-03:00')).toBe(false); // antes de 7h30
    expect(await ok('2026-11-23T10:00:00-03:00')).toBe(false); // segunda
    expect(await ok('2026-12-01T10:00:00-03:00')).toBe(false); // mais de 8 dias
  });
});

describe('criar_pedido', () => {
  it('cria o pedido com preços do banco, reserva estoque e devolve o código', async () => {
    const antes = await restantes('sonho-creme');
    const pedido = await order(
      [
        { linha: 'sonho-creme', quantidade: 2 },
        { linha: 'montado|brioche|creme+goiabada|granulado', quantidade: 1 },
      ],
      { tipo: 'entrega', endereco: 'Rua Fradique Coutinho, 900' },
    );
    // 2 × 850 + (900 + 100 brioche + 50 granulado + 100 meio a meio) + 700 de entrega
    expect(pedido).toMatchObject({ subtotal: 2850, taxa: 700, total: 3550 });
    expect(pedido.codigo).toMatch(/^B-\d{4}$/);
    expect(await restantes('sonho-creme')).toBe(antes - 2);

    const itens = await db.query<{ descricao: string; preco_unit: number }>(
      `select i.descricao, i.preco_unit from public.itens_pedido i
         join public.pedidos p on p.id = i.pedido_id where p.codigo = $1 order by i.preco_unit`,
      [pedido.codigo],
    );
    expect(itens.rows).toEqual([
      { descricao: 'Sonho de creme', preco_unit: 850 },
      {
        descricao: 'Sonho do seu jeito: creme e goiabada, massa brioche, cobertura de granulado',
        preco_unit: 1150,
      },
    ]);
  });

  it('recusa quando não há unidades suficientes, sem reservar nada', async () => {
    const horario = nextSlot(2);
    const rosca = await restantes('rosca-coco', horario);
    const coxinha = await restantes('coxinha', horario);

    const err = await errorOf(
      order(
        [
          { linha: 'coxinha', quantidade: 3 },
          { linha: 'rosca-coco', quantidade: rosca + 1 > 30 ? 30 : rosca + 1 },
        ],
        { horario },
      ),
    );
    expect(err).toMatchObject({ message: 'esgotado', hint: 'rosca-coco', detail: String(rosca) });
    expect(await restantes('coxinha', horario)).toBe(coxinha);
  });

  it('soma linhas que usam o mesmo estoque (vários sonhos montados)', async () => {
    const horario = nextSlot(3);
    await db.query(`update public.produtos set estoque_padrao = 3 where id = 'sonho-montado'`);
    try {
      const err = await errorOf(
        order(
          [
            { linha: 'montado|tradicional|creme|acucar', quantidade: 2 },
            { linha: 'montado|tradicional|goiabada|canela', quantidade: 2 },
          ],
          { horario },
        ),
      );
      expect(err).toMatchObject({ message: 'esgotado', hint: 'sonho-montado', detail: '3' });
    } finally {
      await db.query(`update public.produtos set estoque_padrao = 40 where id = 'sonho-montado'`);
    }
  });

  it('valida nome, endereço, horário e itens', async () => {
    const coxinha = [{ linha: 'coxinha', quantidade: 1 }];
    expect(await errorOf(order(coxinha, { nome: ' A ' }))).toMatchObject({ message: 'dados_invalidos', hint: 'nome' });
    expect(await errorOf(order(coxinha, { tipo: 'entrega' }))).toMatchObject({ hint: 'endereco' });
    expect(await errorOf(order(coxinha, { horario: '2020-01-01T10:00:00-03:00' }))).toMatchObject({
      message: 'horario_invalido',
    });
    expect(await errorOf(order([]))).toMatchObject({ message: 'dados_invalidos', hint: 'itens' });
    for (const quantidade of [0, 31, 2.5]) {
      expect(await errorOf(order([{ linha: 'coxinha', quantidade }]))).toMatchObject({ message: 'item_invalido' });
    }
    expect(await errorOf(order([{ linha: 'bolo-de-festa', quantidade: 1 }]))).toMatchObject({
      message: 'item_invalido',
      hint: 'bolo-de-festa',
    });
  });
});

describe('limites', () => {
  it('a mesma origem só faz alguns pedidos por janela; outra origem continua pedindo', async () => {
    const coxinha = [{ linha: 'coxinha', quantidade: 1 }];
    const ip = '203.0.113.7';
    for (let i = 0; i < 3; i++) await order(coxinha, { ip });
    expect(await errorOf(order(coxinha, { ip }))).toMatchObject({ message: 'limite', hint: 'origem' });
    await expect(order(coxinha, { ip: '203.0.113.8' })).resolves.toMatchObject({ codigo: expect.any(String) });
  });

  it('há um teto de pedidos para a loja inteira na janela', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.pedidos where criado_em > now() - interval '10 minutes'`,
    );
    await comParametro('pedidos_por_janela', rows[0].n + 1, async () => {
      await order([{ linha: 'esfiha', quantidade: 1 }]);
      expect(await errorOf(order([{ linha: 'esfiha', quantidade: 1 }]))).toMatchObject({
        message: 'limite',
        hint: 'geral',
      });
    });
  });

  it('recusa pedidos com unidades demais, sem reservar nada', async () => {
    const horario = nextSlot(6);
    const antes = await restantes('pao-de-queijo', horario);
    const err = await errorOf(
      order(
        [
          { linha: 'pao-de-queijo', quantidade: 30 },
          { linha: 'coxinha', quantidade: 30 },
          { linha: 'esfiha', quantidade: 1 },
        ],
        { horario },
      ),
    );
    expect(err).toMatchObject({ message: 'limite', hint: 'unidades', detail: '60' });
    expect(await restantes('pao-de-queijo', horario)).toBe(antes);
  });

  it('guarda a origem como hash, nunca o IP', async () => {
    const pedido = await order([{ linha: 'coxinha', quantidade: 1 }], { ip: '198.51.100.23' });
    const { rows } = await db.query<{ origem: string }>(`select origem from public.pedidos where codigo = $1`, [
      pedido.codigo,
    ]);
    expect(rows[0].origem).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].origem).not.toContain('198.51');
  });
});

describe('bebidas e combo', () => {
  it('não deixa bebida sair para entrega', async () => {
    const err = await errorOf(
      order(
        [
          { linha: 'coxinha', quantidade: 1 },
          { linha: 'pingado', quantidade: 1 },
        ],
        { tipo: 'entrega', endereco: 'Rua Harmonia, 123' },
      ),
    );
    expect(err).toMatchObject({ message: 'so_retirada', hint: 'pingado' });
    await expect(order([{ linha: 'pingado', quantidade: 1 }])).resolves.toMatchObject({ taxa: 0 });
  });

  it('dá o desconto por par sonho + café, igual à conta do site', async () => {
    const casos: Item[][] = [
      [{ linha: 'sonho-creme', quantidade: 1 }, { linha: 'cafe-coado', quantidade: 1 }],
      [{ linha: 'sonho-creme', quantidade: 3 }, { linha: 'cappuccino', quantidade: 1 }],
      [
        { linha: 'montado|brioche|avela|granulado', quantidade: 2 },
        { linha: 'sonho-goiabada', quantidade: 1 },
        { linha: 'pingado', quantidade: 2 },
        { linha: 'cafe-coado', quantidade: 4 },
      ],
      [{ linha: 'achocolatado-gelado', quantidade: 2 }, { linha: 'sonho-brigadeiro', quantidade: 2 }],
      [{ linha: 'cafe-coado', quantidade: 2 }, { linha: 'croissant-presunto-queijo', quantidade: 1 }],
    ];
    for (const itens of casos) {
      const pedido = await order(itens);
      const site = cartTotals(
        { items: Object.fromEntries(itens.map((i) => [i.linha, i.quantidade])), fulfillment: 'retirada' },
        resolveLine,
      );
      expect({ subtotal: pedido.subtotal, desconto: pedido.desconto, total: pedido.total }).toEqual({
        subtotal: site.subtotal,
        desconto: site.discount,
        total: site.total,
      });
    }
  });
});

describe('acompanhar_pedido', () => {
  it('mostra status e itens pelo token, sem endereço nem sobrenome', async () => {
    const pedido = await order([{ linha: 'sonho-creme', quantidade: 2 }], {
      nome: 'Ana Souza',
      tipo: 'entrega',
      endereco: 'Rua Harmonia, 123',
      obs: 'interfone 12',
    });
    expect(pedido.token).toMatch(/^[0-9a-f-]{36}$/);

    const visto = await acompanhar(pedido.token);
    expect(visto).toMatchObject({
      codigo: pedido.codigo,
      nome: 'Ana',
      tipo: 'entrega',
      status: 'recebido',
      total: pedido.total,
      itens: [{ descricao: 'Sonho de creme', quantidade: 2 }],
    });
    expect(JSON.stringify(visto)).not.toMatch(/Harmonia|interfone|Souza/);

    await as(db, 'authenticated', STAFF, () =>
      db.query(`update public.pedidos set status = 'pronto' where codigo = $1`, [pedido.codigo]),
    );
    expect(await acompanhar(pedido.token)).toMatchObject({ status: 'pronto' });
  });

  it('não acha nada com um token desconhecido', async () => {
    expect(await acompanhar('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('o site público não lê o segredo nem a origem', async () => {
    const err = await errorOf(as(db, 'anon', null, () => db.query(`select * from public.segredo`)));
    expect(err.message).toMatch(/permission denied/);
    const fn = await errorOf(as(db, 'anon', null, () => db.query(`select public.origem_da_requisicao()`)));
    expect(fn.message).toMatch(/permission denied/);
  });
});

describe('permissões', () => {
  it('o site público não lê pedidos, itens nem estoque direto', async () => {
    for (const table of ['pedidos', 'itens_pedido', 'estoque', 'equipe']) {
      const err = await errorOf(as(db, 'anon', null, () => db.query(`select * from public.${table}`)));
      expect(err.message).toMatch(/permission denied/);
    }
  });

  it('o site público não chama funções da equipe', async () => {
    const err = await errorOf(
      as(db, 'anon', null, () => db.query(`select public.ajustar_estoque('coxinha', current_date, 99)`)),
    );
    expect(err.message).toMatch(/permission denied/);
  });

  it('quem está logado mas não é da equipe não vê pedidos', async () => {
    await order([{ linha: 'coxinha', quantidade: 1 }]);
    const { rows } = await as(db, 'authenticated', STRANGER, () => db.query(`select id from public.pedidos`));
    expect(rows).toEqual([]);
    const err = await errorOf(
      as(db, 'authenticated', STRANGER, () => db.query(`select public.ajustar_estoque('coxinha', current_date, 99)`)),
    );
    expect(err.message).toBe('sem_permissao');
  });

  it('a equipe vê pedidos e muda o status, mas não o valor', async () => {
    const pedido = await order([{ linha: 'esfiha', quantidade: 1 }]);
    await as(db, 'authenticated', STAFF, async () => {
      const { rows } = await db.query(`select codigo from public.pedidos where codigo = $1`, [pedido.codigo]);
      expect(rows).toHaveLength(1);
      await db.query(`update public.pedidos set status = 'separado' where codigo = $1`, [pedido.codigo]);
    });
    const err = await errorOf(
      as(db, 'authenticated', STAFF, () =>
        db.query(`update public.pedidos set total = 1 where codigo = $1`, [pedido.codigo]),
      ),
    );
    expect(err.message).toMatch(/permission denied/);
  });

  it('cancelar devolve as unidades ao estoque e não pode ser desfeito', async () => {
    const horario = nextSlot(4);
    const antes = await restantes('pao-de-leite', horario);
    const pedido = await order([{ linha: 'pao-de-leite', quantidade: 3 }], { horario });
    expect(await restantes('pao-de-leite', horario)).toBe(antes - 3);

    await as(db, 'authenticated', STAFF, () =>
      db.query(`update public.pedidos set status = 'cancelado' where codigo = $1`, [pedido.codigo]),
    );
    expect(await restantes('pao-de-leite', horario)).toBe(antes);

    const err = await errorOf(
      as(db, 'authenticated', STAFF, () =>
        db.query(`update public.pedidos set status = 'recebido' where codigo = $1`, [pedido.codigo]),
      ),
    );
    expect(err.message).toBe('pedido_cancelado');
  });

  it('a equipe ajusta o estoque, mas não abaixo do que já foi reservado', async () => {
    const horario = nextSlot(5);
    const dia = horario.slice(0, 10);
    await order([{ linha: 'pote-limao', quantidade: 4 }], { horario });
    const ajustar = (q: number) =>
      as(db, 'authenticated', STAFF, () =>
        db.query<{ r: number }>(`select public.ajustar_estoque('pote-limao', $1, $2) as r`, [dia, q]),
      );
    expect((await ajustar(20)).rows[0].r).toBe(16);
    expect(await errorOf(ajustar(3))).toMatchObject({ message: 'abaixo_do_reservado' });
  });
});
