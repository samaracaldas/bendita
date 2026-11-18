-- Bendita: cardápio, estoque por dia, pedidos e equipe do balcão.
--
-- Regras de segurança:
-- * O site público (role anon) só lê o cardápio e o estoque do dia e cria pedidos
--   pela função criar_pedido, que recalcula preços e reserva estoque numa transação.
-- * Pedidos e estoque só são lidos e alterados por quem está na tabela equipe.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.produtos (
  id text primary key,
  nome text not null,
  preco integer not null check (preco > 0),            -- centavos
  categoria text not null,
  estoque_padrao integer not null default 40 check (estoque_padrao >= 0),
  ativo boolean not null default true
);

create table public.opcoes_sonho (
  id text primary key,
  grupo text not null check (grupo in ('massa', 'recheio', 'cobertura')),
  nome text not null,
  acrescimo integer not null default 0 check (acrescimo >= 0)
);

create table public.parametros (
  chave text primary key,
  valor integer not null
);

-- Uma linha por produto e dia, criada na primeira reserva com o estoque_padrao.
create table public.estoque (
  produto_id text not null references public.produtos (id) on delete cascade,
  dia date not null,
  quantidade integer not null check (quantidade >= 0),
  reservado integer not null default 0 check (reservado >= 0),
  primary key (produto_id, dia),
  constraint estoque_suficiente check (reservado <= quantidade)
);

create type public.status_pedido as enum ('recebido', 'separado', 'pronto', 'entregue', 'cancelado');

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null check (char_length(nome) between 2 and 40),
  tipo text not null check (tipo in ('retirada', 'entrega')),
  endereco text check (endereco is null or char_length(endereco) between 6 and 80),
  horario timestamptz not null,
  obs text check (obs is null or char_length(obs) <= 140),
  subtotal integer not null,
  taxa integer not null,
  total integer not null,
  status public.status_pedido not null default 'recebido',
  criado_em timestamptz not null default now(),
  constraint entrega_tem_endereco check (tipo = 'retirada' or endereco is not null)
);

create index pedidos_horario_idx on public.pedidos (horario);

create table public.itens_pedido (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  linha text not null,
  produto_id text not null references public.produtos (id),
  descricao text not null,
  quantidade integer not null check (quantidade between 1 and 30),
  preco_unit integer not null check (preco_unit > 0)
);

create index itens_pedido_pedido_idx on public.itens_pedido (pedido_id);

create table public.equipe (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null
);

-- ---------------------------------------------------------------------------
-- Regras de negócio
-- ---------------------------------------------------------------------------

create function public.eh_equipe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.equipe where user_id = auth.uid());
$$;

create function public.param(p_chave text)
returns integer
language sql
stable
set search_path = public
as $$
  select valor from public.parametros where chave = p_chave;
$$;

-- Mesmas regras de src/scripts/slots.ts: de 30 em 30 minutos, a partir de meia hora
-- depois da abertura até o fechamento, segunda fechado, até 8 dias à frente.
create function public.horario_valido(p_horario timestamptz, p_agora timestamptz default now())
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  local timestamp := p_horario at time zone 'America/Sao_Paulo';
  dow int := extract(dow from local);
  minutos int := extract(hour from local) * 60 + extract(minute from local);
  abre int := 7 * 60;
  fecha int;
begin
  if p_horario < p_agora + interval '25 minutes' or p_horario > p_agora + interval '8 days' then
    return false;
  end if;
  if extract(second from local) <> 0 or extract(minute from local)::int % 30 <> 0 then
    return false;
  end if;
  fecha := case dow when 1 then null when 0 then 21 * 60 when 6 then 21 * 60 else 20 * 60 end;
  return fecha is not null and minutos >= abre + 30 and minutos <= fecha;
end;
$$;

-- Resolve uma linha da sacola: id do cardápio ou "montado|massa|recheio[+recheio]|cobertura".
-- Mesmas regras de src/data/sonho.ts. Devolve zero linhas quando a linha é inválida.
create function public.resolver_linha(p_linha text)
returns table (produto_id text, descricao text, preco integer)
language plpgsql
stable
set search_path = public
as $$
declare
  partes text[];
  recheios text[];
  massa public.opcoes_sonho;
  cobertura public.opcoes_sonho;
  extras integer;
  nomes_recheio text;
begin
  if p_linha not like 'montado|%' then
    return query
      select p.id, p.nome, p.preco from public.produtos p where p.id = p_linha and p.ativo;
    return;
  end if;

  partes := string_to_array(substr(p_linha, 9), '|');
  if array_length(partes, 1) <> 3 then return; end if;
  recheios := string_to_array(partes[2], '+');
  -- array_length de um array vazio é NULL: o coalesce impede que "" passe.
  if coalesce(array_length(recheios, 1), 0) not between 1 and 2 then return; end if;
  -- Recheios distintos e em ordem: um mesmo sonho tem uma única linha.
  -- COLLATE "C" compara byte a byte, como o sort() do JavaScript.
  if array_length(recheios, 1) = 2 and not (recheios[1] collate "C" < recheios[2] collate "C") then return; end if;

  select * into massa from public.opcoes_sonho o where o.id = partes[1] and o.grupo = 'massa';
  select * into cobertura from public.opcoes_sonho o where o.id = partes[3] and o.grupo = 'cobertura';
  if massa.id is null or cobertura.id is null then return; end if;
  if (select count(*) from public.opcoes_sonho o where o.id = any (recheios) and o.grupo = 'recheio')
     <> array_length(recheios, 1) then
    return;
  end if;

  select coalesce(sum(o.acrescimo), 0), string_agg(o.nome, ' e ' order by o.id)
    into extras, nomes_recheio
    from public.opcoes_sonho o where o.id = any (recheios);

  return query
    select 'sonho-montado'::text,
           format('Sonho do seu jeito: %s, massa %s, %s', lower(nomes_recheio), lower(massa.nome),
                  case when cobertura.id = 'sem' then 'sem cobertura'
                       else 'cobertura de ' || lower(cobertura.nome) end),
           (public.param('sonho_base') + massa.acrescimo + extras + cobertura.acrescimo
             + case when array_length(recheios, 1) = 2 then public.param('meio_a_meio') else 0 end)::integer;
end;
$$;

-- Quanto ainda dá para vender de cada produto num dia.
create function public.estoque_do_dia(p_dia date default (now() at time zone 'America/Sao_Paulo')::date)
returns table (produto_id text, restantes integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(e.quantidade, p.estoque_padrao) - coalesce(e.reservado, 0)
    from public.produtos p
    left join public.estoque e on e.produto_id = p.id and e.dia = p_dia
   where p.ativo
   order by p.id;
$$;

-- Cria o pedido: valida tudo, recalcula preços e reserva estoque de forma atômica.
-- Erros têm message curta para o site traduzir:
--   'dados_invalidos' (hint = campo), 'horario_invalido', 'item_invalido' (hint = linha),
--   'esgotado' (hint = produto_id, detail = unidades restantes).
create function public.criar_pedido(
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
  v_estoque record;
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

  insert into public.pedidos (codigo, nome, tipo, endereco, horario, obs, subtotal, taxa, total)
    values (v_codigo, v_nome, p_tipo, v_endereco, p_horario, v_obs, v_subtotal, v_taxa, v_subtotal + v_taxa)
    returning id into v_pedido;

  insert into public.itens_pedido (pedido_id, linha, produto_id, descricao, quantidade, preco_unit)
    select v_pedido, l.linha, l.produto_id, l.descricao, l.quantidade, l.preco from _linhas l;

  return jsonb_build_object(
    'codigo', v_codigo,
    'subtotal', v_subtotal,
    'taxa', v_taxa,
    'total', v_subtotal + v_taxa,
    'horario', p_horario
  );
end;
$$;

-- Cancelar devolve as unidades ao estoque do dia; descancelar não é permitido.
create function public.ao_mudar_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'cancelado' and new.status <> 'cancelado' then
    raise exception 'pedido_cancelado';
  end if;
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    update public.estoque e
       set reservado = greatest(0, e.reservado - x.unidades)
      from (select i.produto_id, sum(i.quantidade)::integer as unidades
              from public.itens_pedido i where i.pedido_id = new.id group by i.produto_id) x
     where e.produto_id = x.produto_id
       and e.dia = (new.horario at time zone 'America/Sao_Paulo')::date;
  end if;
  return new;
end;
$$;

create trigger pedidos_status
  before update of status on public.pedidos
  for each row execute function public.ao_mudar_status();

-- A equipe ajusta quantas unidades saem num dia (por exemplo, uma fornada a mais).
create function public.ajustar_estoque(p_produto text, p_dia date, p_quantidade integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_restantes integer;
begin
  if not public.eh_equipe() then
    raise exception 'sem_permissao';
  end if;
  insert into public.estoque (produto_id, dia, quantidade)
    values (p_produto, p_dia, p_quantidade)
    on conflict (produto_id, dia) do update set quantidade = excluded.quantidade
    returning quantidade - reservado into v_restantes;
  return v_restantes;
exception
  when check_violation then
    raise exception 'abaixo_do_reservado';
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------------

alter table public.produtos enable row level security;
alter table public.opcoes_sonho enable row level security;
alter table public.parametros enable row level security;
alter table public.estoque enable row level security;
alter table public.pedidos enable row level security;
alter table public.itens_pedido enable row level security;
alter table public.equipe enable row level security;

-- O Supabase concede tudo a anon/authenticated por padrão: começamos do zero.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.produtos, public.opcoes_sonho, public.parametros to anon, authenticated;
create policy "cardápio é público" on public.produtos for select using (true);
create policy "opções são públicas" on public.opcoes_sonho for select using (true);
create policy "parâmetros são públicos" on public.parametros for select using (true);

grant select on public.pedidos, public.itens_pedido, public.estoque, public.equipe to authenticated;
grant update (status) on public.pedidos to authenticated;
create policy "equipe lê pedidos" on public.pedidos for select to authenticated using (public.eh_equipe());
create policy "equipe muda status" on public.pedidos for update to authenticated
  using (public.eh_equipe()) with check (public.eh_equipe());
create policy "equipe lê itens" on public.itens_pedido for select to authenticated using (public.eh_equipe());
create policy "equipe lê estoque" on public.estoque for select to authenticated using (public.eh_equipe());
create policy "cada um se vê na equipe" on public.equipe for select to authenticated using (user_id = auth.uid());

grant execute on function public.criar_pedido(text, text, text, timestamptz, text, jsonb) to anon, authenticated;
grant execute on function public.estoque_do_dia(date) to anon, authenticated;
grant execute on function public.eh_equipe() to authenticated;
grant execute on function public.ajustar_estoque(text, date, integer) to authenticated;

-- Pedidos novos aparecem no painel do balcão em tempo real (respeitando a RLS).
alter publication supabase_realtime add table public.pedidos;

-- ---------------------------------------------------------------------------
-- Dados (os mesmos de src/data/menu.ts e src/data/sonho.ts; um teste confere)
-- ---------------------------------------------------------------------------

insert into public.parametros (chave, valor) values
  ('sonho_base', 900),
  ('meio_a_meio', 100),
  ('taxa_entrega', 700);

insert into public.produtos (id, nome, preco, categoria, estoque_padrao) values
  ('sonho-doce-de-leite', 'Sonho de doce de leite', 950, 'sonhos', 30),
  ('sonho-creme', 'Sonho de creme', 850, 'sonhos', 30),
  ('sonho-brigadeiro', 'Sonho de brigadeiro', 1000, 'sonhos', 24),
  ('sonho-goiabada', 'Sonho de goiabada', 900, 'sonhos', 24),
  ('sonho-montado', 'Sonho do seu jeito', 900, 'sonhos', 40),
  ('pao-de-queijo', 'Pão de queijo', 1200, 'salgados', 60),
  ('coxinha', 'Coxinha de frango', 800, 'salgados', 40),
  ('esfiha', 'Esfiha de carne', 750, 'salgados', 40),
  ('pote-morango', 'Bolo de pote de morango', 1400, 'potes', 16),
  ('pote-prestigio', 'Bolo de pote prestígio', 1500, 'potes', 16),
  ('pote-manga', 'Bolo de pote de manga', 1400, 'potes', 12),
  ('pao-de-leite', 'Pão de leite', 1200, 'paes', 20),
  ('rosca-coco', 'Rosca de coco', 2200, 'paes', 8);

insert into public.opcoes_sonho (id, grupo, nome, acrescimo) values
  ('tradicional', 'massa', 'Tradicional', 0),
  ('brioche', 'massa', 'Brioche', 100),
  ('doce-de-leite', 'recheio', 'Doce de leite', 0),
  ('creme', 'recheio', 'Creme', 0),
  ('brigadeiro', 'recheio', 'Brigadeiro', 0),
  ('goiabada', 'recheio', 'Goiabada', 0),
  ('avela', 'recheio', 'Creme de avelã', 200),
  ('frutas-vermelhas', 'recheio', 'Frutas vermelhas', 150),
  ('acucar', 'cobertura', 'Açúcar', 0),
  ('canela', 'cobertura', 'Açúcar e canela', 0),
  ('granulado', 'cobertura', 'Granulado', 50),
  ('sem', 'cobertura', 'Sem cobertura', 0);
