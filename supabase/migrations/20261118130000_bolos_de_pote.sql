-- Bolos de pote novos: limão siciliano no lugar do de manga e red velvet no lugar do prestígio.
-- Os antigos ficam inativos em vez de apagados: pedidos antigos continuam apontando para eles.
-- Produto inativo some da vitrine, do estoque do dia e do painel, e criar_pedido o recusa.

update public.produtos set ativo = false where id in ('pote-manga', 'pote-prestigio');

insert into public.produtos (id, nome, preco, categoria, estoque_padrao) values
  ('pote-limao', 'Bolo de pote de limão', 1400, 'potes', 14),
  ('pote-red-velvet', 'Bolo de pote red velvet', 1500, 'potes', 16);
