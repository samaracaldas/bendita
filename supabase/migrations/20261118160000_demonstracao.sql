-- Movimento de demonstração para o painel do balcão.
--
-- semear_demonstracao() apaga os exemplos anteriores e cria um dia de pedidos realistas
-- (nomes, horários, itens e status variados) no próximo dia aberto, mais alguns no dia
-- seguinte e três encomendas de festa. Os exemplos ficam marcados com demo = true, reservam
-- estoque como um pedido de verdade e devolvem o estoque quando são apagados.
--
-- Pode rodar à mão no SQL Editor ou todo dia pelo pg_cron (veja o README).
-- O público não chama esta função: só o dono do banco.

alter table public.pedidos add column demo boolean not null default false;
alter table public.encomendas add column demo boolean not null default false;

-- Próximo dia em que a padaria abre (segunda fecha), a partir de p_dia.
create function public.proximo_dia_aberto(p_dia date)
returns date
language sql
immutable
as $$
  select case when extract(isodow from p_dia) = 1 then p_dia + 1 else p_dia end;
$$;

-- Um pedido de exemplo, com as mesmas contas de criar_pedido, sem validação de horário
-- e sem limites (é o banco quem cria). Status cancelado não reserva estoque.
create function public._pedido_demo(
  p_dia date,
  p_hora text,
  p_nome text,
  p_tipo text,
  p_endereco text,
  p_obs text,
  p_status public.status_pedido,
  p_itens jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_horario timestamptz := (p_dia::text || ' ' || p_hora)::timestamp at time zone 'America/Sao_Paulo';
  v_item jsonb;
  v_res record;
  v_subtotal integer := 0;
  v_desconto integer;
  v_taxa integer := 0;
  v_codigo text;
  v_pedido uuid;
  v_estoque record;
begin
  create temp table if not exists _linhas_demo (
    linha text primary key, produto_id text, descricao text, preco integer, quantidade integer
  ) on commit drop;
  truncate _linhas_demo;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_res from public.resolver_linha(v_item ->> 'linha');
    if v_res.produto_id is null then
      raise exception 'item_invalido' using hint = v_item ->> 'linha';
    end if;
    insert into _linhas_demo
      values (v_item ->> 'linha', v_res.produto_id, v_res.descricao, v_res.preco, (v_item ->> 'quantidade')::integer);
    v_subtotal := v_subtotal + v_res.preco * (v_item ->> 'quantidade')::integer;
  end loop;

  select least(
           coalesce(sum(l.quantidade) filter (where p.combo = 'sonho'), 0),
           coalesce(sum(l.quantidade) filter (where p.combo = 'cafe'), 0)
         ) * public.param('desconto_combo')
    into v_desconto
    from _linhas_demo l join public.produtos p on p.id = l.produto_id;

  if p_tipo = 'entrega' then v_taxa := public.param('taxa_entrega'); end if;

  if p_status <> 'cancelado' then
    for v_estoque in
      select l.produto_id, sum(l.quantidade)::integer as unidades from _linhas_demo l group by l.produto_id
    loop
      insert into public.estoque (produto_id, dia, quantidade)
        select p.id, p_dia, p.estoque_padrao from public.produtos p where p.id = v_estoque.produto_id
        on conflict do nothing;
      -- Exemplos nunca deixam a loja sem estoque: se precisar, a fornada do dia cresce.
      update public.estoque e
         set quantidade = greatest(e.quantidade, e.reservado + v_estoque.unidades + 4),
             reservado = e.reservado + v_estoque.unidades
       where e.produto_id = v_estoque.produto_id and e.dia = p_dia;
    end loop;
  end if;

  loop
    v_codigo := 'B-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.pedidos where codigo = v_codigo);
  end loop;

  -- criado_em no passado: os exemplos não contam para o limite de pedidos da janela.
  insert into public.pedidos
    (codigo, nome, tipo, endereco, horario, obs, subtotal, desconto, taxa, total, status, demo, criado_em)
  values
    (v_codigo, p_nome, p_tipo, p_endereco, v_horario, p_obs, v_subtotal, v_desconto, v_taxa,
     v_subtotal - v_desconto + v_taxa, p_status, true, least(now(), v_horario) - interval '2 hours')
  returning id into v_pedido;

  insert into public.itens_pedido (pedido_id, linha, produto_id, descricao, quantidade, preco_unit)
    select v_pedido, l.linha, l.produto_id, l.descricao, l.quantidade, l.preco from _linhas_demo l;

  return v_codigo;
end;
$$;

create function public._encomenda_demo(
  p_dia date,
  p_periodo text,
  p_nome text,
  p_telefone text,
  p_tipo text,
  p_endereco text,
  p_obs text,
  p_status public.status_encomenda,
  p_itens jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_kit record;
  v_nomes text[];
  v_ids text[];
  v_descricao text;
  v_subtotal integer := 0;
  v_taxa integer := 0;
  v_codigo text;
  v_encomenda uuid;
begin
  loop
    v_codigo := 'F-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.encomendas where codigo = v_codigo);
  end loop;

  if p_tipo = 'entrega' then v_taxa := public.param('taxa_entrega_festa'); end if;

  insert into public.encomendas
    (codigo, nome, telefone, data_evento, periodo, tipo, endereco, obs, subtotal, taxa, total, status, demo, criado_em)
  values
    (v_codigo, p_nome, p_telefone, p_dia, p_periodo, p_tipo, p_endereco, p_obs, 0, v_taxa, v_taxa, p_status, true,
     now() - interval '1 day')
  returning id into v_encomenda;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_kit from public.kits_festa where id = v_item ->> 'kit';
    select coalesce(array_agg(f.id order by f.ordem), '{}'), coalesce(array_agg(f.nome order by f.ordem), '{}')
      into v_ids, v_nomes
      from public.sabores_festa f
     where f.kit_id = v_kit.id
       and f.id in (select jsonb_array_elements_text(coalesce(v_item -> 'sabores', '[]'::jsonb)));
    v_descricao := case cardinality(v_nomes)
      when 0 then v_kit.nome
      when 1 then v_kit.nome || ': ' || v_nomes[1]
      else v_kit.nome || ': ' || array_to_string(v_nomes[1:cardinality(v_nomes) - 1], ', ')
           || ' e ' || v_nomes[cardinality(v_nomes)]
    end;
    insert into public.itens_encomenda (encomenda_id, kit_id, sabores, descricao, quantidade, preco_unit)
      values (v_encomenda, v_kit.id, v_ids, v_descricao, (v_item ->> 'quantidade')::integer, v_kit.preco);
    v_subtotal := v_subtotal + v_kit.preco * (v_item ->> 'quantidade')::integer;
  end loop;

  update public.encomendas set subtotal = v_subtotal, total = v_subtotal + v_taxa where id = v_encomenda;
  return v_codigo;
end;
$$;

create function public.semear_demonstracao()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_d1 date := public.proximo_dia_aberto(v_hoje);
  v_d2 date := public.proximo_dia_aberto(v_d1 + 1);
  v_pedidos integer;
  v_encomendas integer;
begin
  -- Devolve o estoque dos exemplos anteriores e apaga.
  update public.estoque e
     set reservado = greatest(0, e.reservado - x.unidades)
    from (select i.produto_id, (p.horario at time zone 'America/Sao_Paulo')::date as dia, sum(i.quantidade)::integer as unidades
            from public.itens_pedido i join public.pedidos p on p.id = i.pedido_id
           where p.demo and p.status <> 'cancelado'
           group by 1, 2) x
   where e.produto_id = x.produto_id and e.dia = x.dia;
  delete from public.pedidos where demo;
  delete from public.encomendas where demo;

  -- Um dia de balcão: o começo já entregue, o meio em andamento, a tarde chegando.
  perform public._pedido_demo(v_d1, '07:30', 'Marina Lopes', 'retirada', null, null, 'entregue',
    '[{"linha":"pao-de-queijo","quantidade":1},{"linha":"cafe-coado","quantidade":2}]');
  perform public._pedido_demo(v_d1, '08:00', 'Rafael Souza', 'entrega', 'Rua Aspicuelta, 220, apto 41', 'Interfone 41, pode deixar na portaria.', 'entregue',
    '[{"linha":"sonho-doce-de-leite","quantidade":2},{"linha":"pingado","quantidade":1},{"linha":"pao-de-leite","quantidade":1}]');
  perform public._pedido_demo(v_d1, '09:30', 'Júlia Andrade', 'retirada', null, null, 'entregue',
    '[{"linha":"montado|brioche|creme+goiabada|canela","quantidade":2},{"linha":"cappuccino","quantidade":2}]');
  perform public._pedido_demo(v_d1, '10:30', 'Pedro Henrique', 'retirada', null, 'Vou buscar de bicicleta, pode embalar bem?', 'cancelado',
    '[{"linha":"coxinha","quantidade":4}]');
  perform public._pedido_demo(v_d1, '11:30', 'Camila Rocha', 'entrega', 'Rua Fradique Coutinho, 1001', null, 'pronto',
    '[{"linha":"coxinha","quantidade":6},{"linha":"esfiha","quantidade":4},{"linha":"pao-de-queijo","quantidade":2}]');
  perform public._pedido_demo(v_d1, '12:00', 'Lucas Ferreira', 'retirada', null, null, 'pronto',
    '[{"linha":"croissant-presunto-queijo","quantidade":2},{"linha":"achocolatado-gelado","quantidade":1}]');
  perform public._pedido_demo(v_d1, '14:00', 'Beatriz Nunes', 'retirada', null, 'É aniversário da minha mãe, se der para escrever um parabéns na caixa!', 'separado',
    '[{"linha":"rosca-coco","quantidade":1},{"linha":"pote-red-velvet","quantidade":2},{"linha":"pote-limao","quantidade":2}]');
  perform public._pedido_demo(v_d1, '15:30', 'Thiago Martins', 'entrega', 'Rua Mourato Coelho, 760, casa 2', null, 'recebido',
    '[{"linha":"sonho-brigadeiro","quantidade":3},{"linha":"sonho-creme","quantidade":3},{"linha":"pote-morango","quantidade":1}]');
  perform public._pedido_demo(v_d1, '16:30', 'Ana Clara Dias', 'retirada', null, null, 'recebido',
    '[{"linha":"montado|tradicional|avela+brigadeiro|granulado","quantidade":1},{"linha":"sonho-goiabada","quantidade":1},{"linha":"cafe-coado","quantidade":2}]');
  perform public._pedido_demo(v_d1, '17:30', 'Gustavo Lima', 'retirada', null, null, 'recebido',
    '[{"linha":"rosquinha-nata","quantidade":2},{"linha":"pao-de-queijo","quantidade":1}]');

  -- Alguns já marcados para o dia seguinte.
  perform public._pedido_demo(v_d2, '08:00', 'Fernanda Costa', 'retirada', null, null, 'recebido',
    '[{"linha":"sonho-doce-de-leite","quantidade":6},{"linha":"cafe-coado","quantidade":3}]');
  perform public._pedido_demo(v_d2, '10:00', 'João Pedro Alves', 'entrega', 'Rua Wisard, 305, apto 12', 'Sem cebola na esfiha, por favor.', 'recebido',
    '[{"linha":"esfiha","quantidade":6},{"linha":"coxinha","quantidade":6}]');
  perform public._pedido_demo(v_d2, '15:00', 'Larissa Prado', 'retirada', null, null, 'recebido',
    '[{"linha":"pote-limao","quantidade":2},{"linha":"cappuccino","quantidade":1}]');

  -- Encomendas de festa nas próximas semanas.
  perform public._encomenda_demo(public.proximo_dia_aberto(v_hoje + 3), 'tarde', 'Patrícia Moura', '11900000101', 'retirada', null,
    'Aniversário de 7 anos, tema dinossauros.', 'confirmada',
    '[{"kit":"salgados","quantidade":2,"sabores":["coxinha","risoles","bolinha-queijo"]},{"kit":"docinhos","quantidade":2,"sabores":["brigadeiro","beijinho"]}]');
  perform public._encomenda_demo(public.proximo_dia_aberto(v_hoje + 6), 'manha', 'Ricardo Teixeira', '11900000102', 'entrega', 'Rua Harmonia, 512, sala 3',
    'Café da manhã da equipe, 40 pessoas.', 'nova',
    '[{"kit":"mini-sonhos","quantidade":1,"sabores":["doce-de-leite","creme"]},{"kit":"pao-de-queijo","quantidade":2,"sabores":[]}]');
  perform public._encomenda_demo(public.proximo_dia_aberto(v_hoje + 12), 'tarde', 'Helena Carvalho', '11900000103', 'retirada', null,
    'Chá de bebê. Tudo bem clarinho, se possível.', 'nova',
    '[{"kit":"mini-sonhos","quantidade":2,"sabores":["creme","goiabada"]},{"kit":"docinhos","quantidade":1,"sabores":["beijinho","cajuzinho"]}]');

  select count(*) into v_pedidos from public.pedidos where demo;
  select count(*) into v_encomendas from public.encomendas where demo;
  return jsonb_build_object('dia', v_d1, 'pedidos', v_pedidos, 'encomendas', v_encomendas);
end;
$$;

revoke all on function public.proximo_dia_aberto(date) from public, anon, authenticated;
revoke all on function public._pedido_demo(date, text, text, text, text, text, public.status_pedido, jsonb)
  from public, anon, authenticated;
revoke all on function public._encomenda_demo(date, text, text, text, text, text, text, public.status_encomenda, jsonb)
  from public, anon, authenticated;
revoke all on function public.semear_demonstracao() from public, anon, authenticated;
