-- Conta de visitante para quem quer ver o painel do balcão (recrutadores, por exemplo).
--
-- * A tabela equipe ganha um papel: 'equipe' (padrão) ou 'visitante'.
-- * O visitante vê tudo o que a equipe vê, mas não muda nada: o status de pedidos e
--   encomendas e o ajuste de estoque exigem o papel 'equipe'. A regra está no banco,
--   não só nos botões do painel.

alter table public.equipe
  add column papel text not null default 'equipe' check (papel in ('equipe', 'visitante'));

-- Quem pode mudar alguma coisa no painel.
create function public.pode_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.equipe where user_id = auth.uid() and papel = 'equipe');
$$;

-- O painel usa para saber se mostra os botões.
create function public.papel_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.equipe where user_id = auth.uid();
$$;

drop policy "equipe muda status" on public.pedidos;
create policy "equipe muda status" on public.pedidos for update to authenticated
  using (public.pode_editar()) with check (public.pode_editar());

drop policy "equipe muda status da encomenda" on public.encomendas;
create policy "equipe muda status da encomenda" on public.encomendas for update to authenticated
  using (public.pode_editar()) with check (public.pode_editar());

create or replace function public.ajustar_estoque(p_produto text, p_dia date, p_quantidade integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_restantes integer;
begin
  if not public.pode_editar() then
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

revoke all on function public.pode_editar() from public, anon;
revoke all on function public.papel_atual() from public, anon;
grant execute on function public.pode_editar() to authenticated;
grant execute on function public.papel_atual() to authenticated;
