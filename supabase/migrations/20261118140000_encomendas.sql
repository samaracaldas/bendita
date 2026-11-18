-- Encomendas de festa: vendidas por cento, com pelo menos 2 dias de antecedência.
--
-- * O site chama criar_encomenda com kits, quantidade de centos e sabores. O banco confere
--   tudo de novo (kit, sabores permitidos, data, período, telefone), recalcula o preço e
--   aplica o mesmo limite por aparelho dos pedidos.
-- * A equipe vê as encomendas no painel e muda o status (nova, confirmada, pronta,
--   entregue, cancelada). O site público não lê encomendas.
-- * Mesmas regras de src/data/festa.ts; um teste confere.

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create table public.kits_festa (
  id text primary key,
  nome text not null,
  preco integer not null check (preco > 0),               -- centavos por cento
  max_sabores integer not null check (max_sabores between 0 and 4),
  ordem integer not null
);

create table public.sabores_festa (
  kit_id text not null references public.kits_festa (id),
  id text not null,
  nome text not null,
  ordem integer not null,
  primary key (kit_id, id)
);

insert into public.kits_festa (id, nome, preco, max_sabores, ordem) values
  ('salgados', 'Salgados mistos', 9500, 3, 1),
  ('docinhos', 'Docinhos de festa', 12000, 3, 2),
  ('mini-sonhos', 'Mini sonhos', 16000, 2, 3),
  ('pao-de-queijo', 'Pão de queijo coquetel', 6500, 0, 4);

insert into public.sabores_festa (kit_id, id, nome, ordem) values
  ('salgados', 'coxinha', 'coxinha', 1),
  ('salgados', 'risoles', 'risoles', 2),
  ('salgados', 'bolinha-queijo', 'bolinha de queijo', 3),
  ('salgados', 'esfiha', 'mini esfiha', 4),
  ('docinhos', 'brigadeiro', 'brigadeiro', 1),
  ('docinhos', 'beijinho', 'beijinho', 2),
  ('docinhos', 'bicho-de-pe', 'bicho-de-pé', 3),
  ('docinhos', 'cajuzinho', 'cajuzinho', 4),
  ('mini-sonhos', 'doce-de-leite', 'doce de leite', 1),
  ('mini-sonhos', 'creme', 'creme', 2),
  ('mini-sonhos', 'goiabada', 'goiabada', 3),
  ('mini-sonhos', 'brigadeiro', 'brigadeiro', 4);

insert into public.parametros (chave, valor) values
  ('taxa_entrega_festa', 1500),
  ('max_centos', 10),
  ('antecedencia_dias', 2),
  ('ate_dias', 60);

-- ---------------------------------------------------------------------------
-- Encomendas
-- ---------------------------------------------------------------------------

create type public.status_encomenda as enum ('nova', 'confirmada', 'pronta', 'entregue', 'cancelada');

create table public.encomendas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  token uuid not null unique default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 40),
  telefone text not null check (telefone ~ '^\d{10,11}$'),
  data_evento date not null,
  periodo text not null check (periodo in ('manha', 'tarde')),
  tipo text not null check (tipo in ('retirada', 'entrega')),
  endereco text check (endereco is null or char_length(endereco) between 6 and 80),
  obs text check (obs is null or char_length(obs) <= 200),
  subtotal integer not null,
  taxa integer not null,
  total integer not null,
  status public.status_encomenda not null default 'nova',
  origem text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint encomenda_entrega_tem_endereco check (tipo = 'retirada' or endereco is not null)
);

create index encomendas_data_idx on public.encomendas (data_evento);
create index encomendas_origem_idx on public.encomendas (origem, criado_em);

create table public.itens_encomenda (
  id bigint generated always as identity primary key,
  encomenda_id uuid not null references public.encomendas (id) on delete cascade,
  kit_id text not null references public.kits_festa (id),
  sabores text[] not null default '{}',
  descricao text not null,
  quantidade integer not null check (quantidade between 1 and 10),
  preco_unit integer not null
);

create index itens_encomenda_encomenda_idx on public.itens_encomenda (encomenda_id);

create trigger encomendas_atualizado_em
  before update of status on public.encomendas
  for each row execute function public.tocar_pedido();

-- ---------------------------------------------------------------------------
-- criar_encomenda
-- ---------------------------------------------------------------------------

-- Erros: 'dados_invalidos' (hint = campo: nome, telefone, data, periodo, tipo, endereco,
-- obs, itens), 'item_invalido' (hint = kit), 'limite' (hint = 'origem').
create function public.criar_encomenda(
  p_nome text,
  p_telefone text,
  p_data date,
  p_periodo text,
  p_tipo text,
  p_endereco text,
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
  v_telefone text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_endereco text := nullif(btrim(coalesce(p_endereco, '')), '');
  v_obs text := nullif(btrim(coalesce(p_obs, '')), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_origem text := public.origem_da_requisicao();
  v_item jsonb;
  v_kit record;
  v_qtd integer;
  v_sabores text[];
  v_nomes text[];
  v_descricao text;
  v_subtotal integer := 0;
  v_taxa integer := 0;
  v_codigo text;
  v_encomenda uuid;
  v_token uuid;
begin
  if char_length(v_nome) not between 2 and 40 then
    raise exception 'dados_invalidos' using hint = 'nome';
  end if;
  if v_telefone !~ '^\d{10,11}$' then
    raise exception 'dados_invalidos' using hint = 'telefone';
  end if;
  if p_data is null
     or p_data < v_hoje + public.param('antecedencia_dias')
     or p_data > v_hoje + public.param('ate_dias')
     or extract(isodow from p_data) = 1 then
    raise exception 'dados_invalidos' using hint = 'data';
  end if;
  if p_periodo not in ('manha', 'tarde') or p_periodo is null then
    raise exception 'dados_invalidos' using hint = 'periodo';
  end if;
  if p_tipo not in ('retirada', 'entrega') or p_tipo is null then
    raise exception 'dados_invalidos' using hint = 'tipo';
  end if;
  if p_tipo = 'entrega' and (v_endereco is null or char_length(v_endereco) not between 6 and 80) then
    raise exception 'dados_invalidos' using hint = 'endereco';
  end if;
  if p_tipo = 'retirada' then v_endereco := null; end if;
  if v_obs is not null and char_length(v_obs) > 200 then
    raise exception 'dados_invalidos' using hint = 'obs';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) not between 1 and 4 then
    raise exception 'dados_invalidos' using hint = 'itens';
  end if;
  if (select count(distinct e ->> 'kit') from jsonb_array_elements(p_itens) e) <> jsonb_array_length(p_itens) then
    raise exception 'dados_invalidos' using hint = 'itens';
  end if;

  perform pg_advisory_xact_lock(hashtext('criar_encomenda:' || v_origem));
  if (select count(*) from public.encomendas
       where origem = v_origem
         and criado_em > now() - make_interval(mins => public.param('janela_minutos')))
     >= public.param('pedidos_por_origem') then
    raise exception 'limite' using hint = 'origem';
  end if;

  create temp table if not exists _itens_festa (
    kit_id text, sabores text[], descricao text, quantidade integer, preco integer
  ) on commit drop;
  truncate _itens_festa;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_kit from public.kits_festa where id = v_item ->> 'kit';
    if v_kit.id is null then
      raise exception 'item_invalido' using hint = coalesce(v_item ->> 'kit', '');
    end if;

    if jsonb_typeof(v_item -> 'quantidade') <> 'number'
       or (v_item ->> 'quantidade')::numeric <> floor((v_item ->> 'quantidade')::numeric)
       or (v_item ->> 'quantidade')::numeric not between 1 and public.param('max_centos') then
      raise exception 'item_invalido' using hint = v_kit.id;
    end if;
    v_qtd := (v_item ->> 'quantidade')::integer;

    if jsonb_typeof(coalesce(v_item -> 'sabores', '[]'::jsonb)) <> 'array' then
      raise exception 'item_invalido' using hint = v_kit.id;
    end if;
    select coalesce(array_agg(s), '{}') into v_sabores
      from jsonb_array_elements_text(coalesce(v_item -> 'sabores', '[]'::jsonb)) s;

    if coalesce(array_length(v_sabores, 1), 0) < least(v_kit.max_sabores, 1)
       or coalesce(array_length(v_sabores, 1), 0) > v_kit.max_sabores
       or (select count(distinct s) from unnest(v_sabores) s) <> coalesce(array_length(v_sabores, 1), 0)
       or exists (select 1 from unnest(v_sabores) s
                   where not exists (select 1 from public.sabores_festa f where f.kit_id = v_kit.id and f.id = s)) then
      raise exception 'item_invalido' using hint = v_kit.id;
    end if;

    -- Sabores na ordem do cardápio: "Mini sonhos: doce de leite e creme".
    select coalesce(array_agg(f.id order by f.ordem), '{}'), coalesce(array_agg(f.nome order by f.ordem), '{}')
      into v_sabores, v_nomes
      from public.sabores_festa f
     where f.kit_id = v_kit.id and f.id = any (v_sabores);
    v_descricao := case cardinality(v_nomes)
      when 0 then v_kit.nome
      when 1 then v_kit.nome || ': ' || v_nomes[1]
      else v_kit.nome || ': ' || array_to_string(v_nomes[1:cardinality(v_nomes) - 1], ', ')
           || ' e ' || v_nomes[cardinality(v_nomes)]
    end;

    insert into _itens_festa values (v_kit.id, v_sabores, v_descricao, v_qtd, v_kit.preco);
    v_subtotal := v_subtotal + v_kit.preco * v_qtd;
  end loop;

  if p_tipo = 'entrega' then v_taxa := public.param('taxa_entrega_festa'); end if;

  loop
    v_codigo := 'F-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.encomendas where codigo = v_codigo);
  end loop;

  insert into public.encomendas
    (codigo, nome, telefone, data_evento, periodo, tipo, endereco, obs, subtotal, taxa, total, origem)
  values
    (v_codigo, v_nome, v_telefone, p_data, p_periodo, p_tipo, v_endereco, v_obs, v_subtotal, v_taxa,
     v_subtotal + v_taxa, v_origem)
  returning id, token into v_encomenda, v_token;

  insert into public.itens_encomenda (encomenda_id, kit_id, sabores, descricao, quantidade, preco_unit)
    select v_encomenda, i.kit_id, i.sabores, i.descricao, i.quantidade, i.preco from _itens_festa i;

  return jsonb_build_object(
    'codigo', v_codigo,
    'token', v_token,
    'subtotal', v_subtotal,
    'taxa', v_taxa,
    'total', v_subtotal + v_taxa
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------

alter table public.kits_festa enable row level security;
alter table public.sabores_festa enable row level security;
alter table public.encomendas enable row level security;
alter table public.itens_encomenda enable row level security;

revoke all on public.kits_festa, public.sabores_festa, public.encomendas, public.itens_encomenda
  from anon, authenticated;

grant select on public.kits_festa, public.sabores_festa to anon, authenticated;
create policy "kits são públicos" on public.kits_festa for select using (true);
create policy "sabores são públicos" on public.sabores_festa for select using (true);

grant select on public.encomendas, public.itens_encomenda to authenticated;
grant update (status) on public.encomendas to authenticated;
create policy "equipe lê encomendas" on public.encomendas for select to authenticated using (public.eh_equipe());
create policy "equipe muda status da encomenda" on public.encomendas for update to authenticated
  using (public.eh_equipe()) with check (public.eh_equipe());
create policy "equipe lê itens da encomenda" on public.itens_encomenda for select to authenticated
  using (public.eh_equipe());

revoke all on function public.criar_encomenda(text, text, date, text, text, text, text, jsonb) from public;
grant execute on function public.criar_encomenda(text, text, date, text, text, text, text, jsonb) to anon, authenticated;

alter publication supabase_realtime add table public.encomendas;
