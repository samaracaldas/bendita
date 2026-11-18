-- Limites contra pedidos em massa e acompanhamento do pedido pelo cliente.
--
-- * Cada pedido guarda de onde veio (hash do IP com um segredo, nunca o IP em si).
--   criar_pedido recusa quando a mesma origem passa do limite numa janela de tempo,
--   quando a loja inteira passa do teto da janela, ou quando o pedido tem unidades demais.
--   O limite por origem depende do cabeçalho x-forwarded-for e é de melhor esforço;
--   o teto geral não depende de nada que o cliente controle.
-- * Cada pedido ganha um token aleatório. O cliente acompanha o status pelo token
--   (acompanhar_pedido), que não expõe endereço, observação nem sobrenome.

-- ---------------------------------------------------------------------------
-- Parâmetros e segredo
-- ---------------------------------------------------------------------------

insert into public.parametros (chave, valor) values
  ('janela_minutos', 10),
  ('pedidos_por_origem', 3),
  ('pedidos_por_janela', 30),
  ('max_unidades', 60);

-- Sal do hash da origem. Só funções security definer leem esta tabela.
create table public.segredo (
  id boolean primary key default true check (id),
  sal text not null default gen_random_uuid()::text
);
insert into public.segredo default values;
alter table public.segredo enable row level security;
revoke all on public.segredo from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Colunas novas em pedidos
-- ---------------------------------------------------------------------------

alter table public.pedidos
  add column token uuid not null default gen_random_uuid(),
  add column origem text,
  add column atualizado_em timestamptz not null default now();

alter table public.pedidos add constraint pedidos_token_key unique (token);
create index pedidos_criado_em_idx on public.pedidos (criado_em);
create index pedidos_origem_idx on public.pedidos (origem, criado_em);

create function public.tocar_pedido()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger pedidos_atualizado_em
  before update of status on public.pedidos
  for each row execute function public.tocar_pedido();

-- ---------------------------------------------------------------------------
-- Origem da requisição
-- ---------------------------------------------------------------------------

-- PostgREST expõe os cabeçalhos em request.headers. Sem cabeçalho (SQL Editor,
-- testes), todas as chamadas caem na mesma origem "sem-ip".
create function public.origem_da_requisicao()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(sha256(convert_to(
    coalesce(
      nullif(btrim(split_part(
        nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1
      )), ''),
      'sem-ip'
    ) || (select sal from public.segredo),
    'UTF8'
  )), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- criar_pedido com limites e token
-- ---------------------------------------------------------------------------

-- Erros novos, além dos da primeira migration:
--   'limite' com hint 'origem' (muitos pedidos deste aparelho), 'geral' (muitos pedidos
--   na loja) ou 'unidades' (detail = máximo de unidades por pedido).
create or replace function public.criar_pedido(
  p_nome text,
  p_tipo text,
  p_endereco text,
  p_horario timestamptz,
  p_obs text,
  p_itens jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_endereco text := nullif(btrim(coalesce(p_endereco, '')), '');
  v_obs text := nullif(btrim(coalesce(p_obs, '')), '');
  v_dia date;
  v_item jsonb;
  v_linha text;
  v_qtd integer;
  v_res record;
  v_subtotal integer := 0;
  v_taxa integer := 0;
  v_codigo text;
  v_pedido uuid;
  v_token uuid;
  v_estoque record;
  v_origem text := public.origem_da_requisicao();
  v_janela interval := make_interval(mins => public.param('janela_minutos'));
begin
  if char_length(v_nome) not between 2 and 40 then
    raise exception 'dados_invalidos' using hint = 'nome';
  end if;
  if p_tipo not in ('retirada', 'entrega') then
    raise exception 'dados_invalidos' using hint = 'tipo';
  end if;
  if p_tipo = 'entrega' and (v_endereco is null or char_length(v_endereco) not between 6 and 80) then
    raise exception 'dados_invalidos' using hint = 'endereco';
  end if;
  if p_tipo = 'retirada' then v_endereco := null; end if;
  if v_obs is not null and char_length(v_obs) > 140 then
    raise exception 'dados_invalidos' using hint = 'obs';
  end if;
  if p_horario is null or not public.horario_valido(p_horario) then
    raise exception 'horario_invalido';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) not between 1 and 30 then
    raise exception 'dados_invalidos' using hint = 'itens';
  end if;

  -- Uma origem por vez: dois pedidos simultâneos do mesmo aparelho não furam o limite.
  perform pg_advisory_xact_lock(hashtext('criar_pedido:' || v_origem));
  if (select count(*) from public.pedidos
       where origem = v_origem and criado_em > now() - v_janela) >= public.param('pedidos_por_origem') then
    raise exception 'limite' using hint = 'origem';
  end if;
  if (select count(*) from public.pedidos
       where criado_em > now() - v_janela) >= public.param('pedidos_por_janela') then
    raise exception 'limite' using hint = 'geral';
  end if;

  v_dia := (p_horario at time zone 'America/Sao_Paulo')::date;

  create temp table if not exists _linhas (
    linha text primary key, produto_id text, descricao text, preco integer, quantidade integer
  ) on commit drop;
  truncate _linhas;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_linha := v_item ->> 'linha';
    if jsonb_typeof(v_item -> 'quantidade') <> 'number' then
      raise exception 'item_invalido' using hint = coalesce(v_linha, '');
    end if;
    v_qtd := (v_item ->> 'quantidade')::numeric;
    if v_qtd::numeric <> (v_item ->> 'quantidade')::numeric or v_qtd not between 1 and 30 then
      raise exception 'item_invalido' using hint = coalesce(v_linha, '');
    end if;
    select * into v_res from public.resolver_linha(v_linha);
    if v_res.produto_id is null then
      raise exception 'item_invalido' using hint = coalesce(v_linha, '');
    end if;
    insert into _linhas values (v_linha, v_res.produto_id, v_res.descricao, v_res.preco, v_qtd)
      on conflict (linha) do update set quantidade = _linhas.quantidade + excluded.quantidade;
    v_subtotal := v_subtotal + v_res.preco * v_qtd;
  end loop;

  if (select sum(quantidade) from _linhas) > public.param('max_unidades') then
    raise exception 'limite' using hint = 'unidades', detail = public.param('max_unidades')::text;
  end if;

  -- Reserva estoque produto a produto, sempre na mesma ordem para evitar deadlock.
  for v_estoque in
    select l.produto_id, sum(l.quantidade)::integer as unidades
      from _linhas l group by l.produto_id order by l.produto_id
  loop
    insert into public.estoque (produto_id, dia, quantidade)
      select p.id, v_dia, p.estoque_padrao from public.produtos p where p.id = v_estoque.produto_id
      on conflict do nothing;

    perform 1 from public.estoque e
      where e.produto_id = v_estoque.produto_id and e.dia = v_dia
      for update;

    update public.estoque e
       set reservado = e.reservado + v_estoque.unidades
     where e.produto_id = v_estoque.produto_id and e.dia = v_dia
       and e.quantidade - e.reservado >= v_estoque.unidades;

    if not found then
      raise exception 'esgotado' using
        hint = v_estoque.produto_id,
        detail = (select (e.quantidade - e.reservado)::text from public.estoque e
                   where e.produto_id = v_estoque.produto_id and e.dia = v_dia);
    end if;
  end loop;

  if p_tipo = 'entrega' then v_taxa := public.param('taxa_entrega'); end if;

  loop
    v_codigo := 'B-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.pedidos where codigo = v_codigo);
  end loop;

  insert into public.pedidos (codigo, nome, tipo, endereco, horario, obs, subtotal, taxa, total, origem)
    values (v_codigo, v_nome, p_tipo, v_endereco, p_horario, v_obs, v_subtotal, v_taxa, v_subtotal + v_taxa, v_origem)
    returning id, token into v_pedido, v_token;

  insert into public.itens_pedido (pedido_id, linha, produto_id, descricao, quantidade, preco_unit)
    select v_pedido, l.linha, l.produto_id, l.descricao, l.quantidade, l.preco from _linhas l;

  return jsonb_build_object(
    'codigo', v_codigo,
    'token', v_token,
    'subtotal', v_subtotal,
    'taxa', v_taxa,
    'total', v_subtotal + v_taxa,
    'horario', p_horario
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Acompanhamento
-- ---------------------------------------------------------------------------

-- O que o cliente vê do próprio pedido. Devolve null para token desconhecido.
create function public.acompanhar_pedido(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'codigo', p.codigo,
    'nome', split_part(p.nome, ' ', 1),
    'tipo', p.tipo,
    'horario', p.horario,
    'status', p.status,
    'subtotal', p.subtotal,
    'taxa', p.taxa,
    'total', p.total,
    'atualizado_em', p.atualizado_em,
    'itens', coalesce(
      (select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'quantidade', i.quantidade)
                        order by i.preco_unit desc, i.descricao)
         from public.itens_pedido i where i.pedido_id = p.id),
      '[]'::jsonb
    )
  )
  from public.pedidos p
  where p.token = p_token
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------

revoke all on function public.origem_da_requisicao() from public, anon, authenticated;
revoke all on function public.tocar_pedido() from public, anon, authenticated;
revoke all on function public.acompanhar_pedido(uuid) from public;
grant execute on function public.acompanhar_pedido(uuid) to anon, authenticated;
-- create or replace mantém as permissões de criar_pedido; reforçamos mesmo assim.
revoke all on function public.criar_pedido(text, text, text, timestamptz, text, jsonb) from public;
grant execute on function public.criar_pedido(text, text, text, timestamptz, text, jsonb) to anon, authenticated;
