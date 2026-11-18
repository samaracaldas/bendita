-- Rode no SQL Editor do Supabase depois da migration 20261118160000_demonstracao.sql.
-- Não é migration: são ações sobre os dados do projeto no ar.

-- 1. Apaga os pedidos e encomendas de teste feitos durante o desenvolvimento.
--    Cancelar antes de apagar devolve as unidades ao estoque do dia.
update public.pedidos set status = 'cancelado'
 where not demo and nome ilike 'teste%' and status <> 'cancelado';
delete from public.pedidos where not demo and nome ilike 'teste%';
delete from public.encomendas where not demo and nome ilike 'teste%';

-- 2. Cria o movimento de demonstração (pode rodar de novo quando quiser: ele refaz tudo).
select public.semear_demonstracao();

-- 3. Opcional: refaz o movimento todo dia às 6h de São Paulo (9h UTC), para o painel
--    nunca ficar vazio. Antes, ligue a extensão pg_cron em Database > Extensions.
-- select cron.schedule('bendita-demonstracao', '0 9 * * *', $$select public.semear_demonstracao()$$);
