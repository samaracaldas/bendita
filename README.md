# Bendita

[![CI](https://github.com/samaracaldas/bendita/actions/workflows/ci.yml/badge.svg)](https://github.com/samaracaldas/bendita/actions/workflows/ci.yml)

Loja de uma doceria e padaria fictícia da Vila Madalena: vitrine com estoque do dia, montador de sonho, sacola,
pedidos gravados no Supabase e um painel do balcão que recebe os pedidos em tempo real.
Substitui dois projetos antigos do meu portfólio, o Ice Land (2024, jQuery) e o The Bake (Angular).

**No ar:** [loja](https://bendita-samaracaldas.vercel.app/) ·
[painel do balcão](https://bendita-samaracaldas.vercel.app/balcao) (clique em **Entrar como visitante**: dá para ver
tudo, sem mudar nada). Faça um pedido na loja numa aba e veja ele chegar no painel na outra.

## O que tem

- **Vitrine** com 18 produtos (sonhos, salgados, bolos de pote, pães e bebidas) e filtro por categoria. Cada card
  mostra quantas unidades restam hoje e fica "Esgotado"
  quando acaba.
- **Monte o seu sonho**: massa, até dois recheios (meio a meio) e cobertura, com prévia ilustrada e preço ao vivo.
- **Combo sonho + café**: cada par de sonho (inclusive o montado) com café coado, pingado ou cappuccino sai R$ 2,00
  mais barato. Um cartão no topo da vitrine deixa escolher o par e colocar os dois na sacola de uma vez. O desconto
  aparece na sacola e é recalculado pelo banco.
- **Sai do forno às…**: pão de queijo, esfiha, croissant e pão de leite mostram a próxima fornada, no horário de São
  Paulo, pulando a segunda (dia de folga). O texto se atualiza a cada minuto.
- **Bebida só na retirada**: café quente não viaja bem. Com bebida na sacola e entrega escolhida, a sacola explica e
  segura o pedido até a pessoa tirar a bebida ou mudar para retirada; o banco também recusa.
- **Sacola**: adicionar e remover, ajustar quantidade sem passar do estoque, retirada (grátis) ou entrega (R$ 7,00).
  Fica no `localStorage`, sobrevive a recargas e se sincroniza entre abas.
- **Pedido de verdade**: nome, horário (de 30 em 30 minutos, dentro do horário de funcionamento) e endereço na entrega.
  O banco recalcula os preços, confere o horário e reserva o estoque numa transação. Se algo esgotou nesse meio-tempo,
  a sacola volta explicando o que mudou. Não há pagamento online: paga-se na retirada ou na entrega.
- **Acompanhe seu pedido** (`/pedido?t=…`): depois de confirmar, o cliente recebe um link com o andamento (recebido,
  separando, pronto, retirado ou saiu para entrega). A página se atualiza sozinha a cada 15 segundos e para quando o
  pedido termina. A loja também mostra "Seu pedido" no topo por dois dias.
- **Encomenda de festa**: centos de salgados, docinhos, mini sonhos e pão de queijo coquetel, com até 2 ou 3 sabores
  por kit, para pelo menos 2 dias depois (até 60 dias, nunca segunda), de manhã ou de tarde, retirada ou entrega
  (R$ 15,00). O banco confere kit, sabores, data e telefone e recalcula o preço; a confirmação é pelo WhatsApp.
- **Painel do balcão** (`/balcao`): login da equipe, pedidos do dia por status (recebido, separado, pronto,
  entregue) com miniatura de cada produto, cancelamento que devolve as unidades ao estoque, ajuste do estoque do dia,
  encomendas de festa dos próximos dias (nova, confirmada, pronta, entregue) com link direto para o WhatsApp do
  cliente, e atualização ao vivo pelo Supabase Realtime.
- **Visitante no painel**: um botão "Entrar como visitante" abre o painel numa conta somente leitura. Ela vê pedidos,
  encomendas e estoque ao vivo, mas o banco recusa qualquer mudança (papel `visitante` na tabela `equipe`).
- **Sobre a Bendita** (`/sobre`): a história da padaria, as três regras da cozinha e a equipe.
- **Modo demonstração**: sem as variáveis do Supabase, o site funciona igual, mas o pedido é simulado no navegador.

## Como o pedido funciona

```
navegador                                 Supabase (Postgres)
estoque_do_dia(dia)            -------->  restantes por produto (público)
criar_pedido(nome, tipo,       -------->  valida dados e horário
  horário, itens: linha + qtd)            recalcula preços (cardápio + opções do sonho)
                                          reserva estoque por produto e dia (FOR UPDATE)
                               <--------  código do pedido e total
painel /balcao  <--- Realtime ---------   pedidos (só para a equipe, via RLS)
```

- O navegador nunca manda preço: só a "linha" (`coxinha` ou `montado|brioche|creme+goiabada|canela`) e a quantidade.
- O site público (chave `anon`) só lê o cardápio e o estoque e chama `criar_pedido`. Pedidos, itens e estoque só são
  lidos e alterados por quem está na tabela `equipe`, por meio de políticas RLS.
- **Limites contra abuso**: no máximo 3 pedidos por aparelho a cada 10 minutos, 30 pedidos na loja inteira nessa
  janela e 60 unidades por pedido. O aparelho é identificado por um hash do IP com um segredo do banco; o IP nunca é
  gravado. Como o IP vem do cabeçalho `x-forwarded-for`, o limite por aparelho é de melhor esforço; o teto geral não
  depende de nada que o cliente controle. Os valores ficam na tabela `parametros`.
- **Acompanhamento sem expor ninguém**: o código do pedido (B-1234) é fácil de adivinhar, então o link usa um token
  aleatório. `acompanhar_pedido` devolve status, horário, itens e total, mas não o endereço, a observação nem o
  sobrenome.
- As migrations ficam em `supabase/migrations` e rodam em ordem: `20261117120000_bendita.sql` (schema, regras e dados),
  `20261118090000_limites_e_acompanhamento.sql` (limites e acompanhamento) e `20261118120000_bebidas_e_combo.sql`
  (bebidas, croissant, rosquinha e combo), `20261118130000_bolos_de_pote.sql` (bolos de pote de limão e red velvet no
  lugar de manga e prestígio), `20261118140000_encomendas.sql` (encomendas de festa) e `20261118150000_visitante.sql`
  (conta de visitante somente leitura) e `20261118160000_demonstracao.sql` (movimento de demonstração).

## Segurança

- **Banco fechado por padrão**: RLS em todas as tabelas e permissões dadas uma a uma. O público só lê cardápio, kits e
  estoque e só escreve pelas funções `criar_pedido` e `criar_encomenda`. Pedidos, encomendas, endereços e telefones só
  são lidos por quem está na tabela `equipe`, que pode mudar o status, mas não o valor.
- **O navegador não decide preço**: o banco recalcula preços, desconto do combo e taxas, e reserva o estoque numa
  transação com trava por produto.
- **Limites**: pedidos e encomendas por aparelho e por janela de tempo, teto geral e máximo de unidades. O IP nunca é
  gravado, só um hash com um segredo que o público não lê.
- **Links privados**: o acompanhamento usa um token aleatório e não mostra endereço, telefone nem sobrenome.
- **Equipe**: cadastro público desligado no Supabase; o painel e o acompanhamento não entram em buscadores.
- **Cabeçalhos** (`vercel.json`): Content-Security-Policy só com o próprio site e o Supabase, sem scripts inline;
  `frame-ancestors 'none'` e `X-Frame-Options` contra clickjacking; `nosniff`, `Referrer-Policy`, `Permissions-Policy`
  e HSTS. O `astro preview` ignora o `vercel.json`, então `tests/e2e/seguranca.spec.ts` aplica esses cabeçalhos no
  navegador e falha se alguma parte do site for bloqueada.
- **Texto de cliente nunca vira HTML**: nomes, observações e endereços entram na página com `textContent`.
- Só a chave pública (publishable) do Supabase vai para o site. O `.env` fica fora do git.

## Acessibilidade

- HTML semântico, link para pular ao conteúdo e títulos em ordem.
- A sacola é um `<dialog>` modal: prende o foco, fecha com Esc e devolve o foco ao botão que a abriu.
- Os botões de quantidade e de remover têm nomes acessíveis com o nome do produto. As mudanças na sacola são anunciadas
  numa região `aria-live`.
- Foco visível em todos os controles, contraste AA e `prefers-reduced-motion` respeitado.

## Stack

- [Astro](https://astro.build) 7, com saída estática
- [Supabase](https://supabase.com): Postgres com RLS, funções em PL/pgSQL, Auth para a equipe e Realtime para o painel.
  A loja chama o banco com `fetch` direto (PostgREST), sem carregar o supabase-js; ele só entra no painel.
- TypeScript, sem framework de UI: a sacola é uma store pequena (`src/scripts/cart-store.ts`) e um módulo que renderiza
  a gaveta (`src/scripts/cart-ui.ts`)
- CSS puro com tokens, e fontes Bagel Fat One e Gabarito servidas localmente pelo Fontsource
- Ilustrações em SVG feitas à mão (`src/components/Illustration.astro`), usadas como adesivos sobre as fotos
- Fotos otimizadas pelo `<Image>` do Astro (WebP em várias larguras)

## Fotos

Todas são do [Pexels](https://www.pexels.com), sob a [Licença Pexels](https://www.pexels.com/pt-br/licenca/), que é
gratuita e não exige crédito. Ficam em `src/assets/fotos`, com o nome do arquivo igual ao id do produto. O número é o ID da
foto no Pexels (`https://www.pexels.com/photo/<id>/`):

| Arquivo | ID |
| --- | --- |
| sonho-doce-de-leite | 7144270 |
| sonho-creme | 19028086 |
| sonho-brigadeiro | 38638101 |
| sonho-goiabada | 26898038 |
| pao-de-queijo | 20450299 |
| coxinha | 33938859 |
| esfiha | 6889716 |
| pote-morango | 34586996 |
| pote-red-velvet | 39344595 |
| pote-limao | 3026801 |
| pao-de-leite | 31972201 |
| rosca-coco | 1626667 |
| croissant-presunto-queijo | 38845411 |
| rosquinha-nata | 797761 |
| cafe-coado | 34995048 |
| pingado | 26755323 |
| cappuccino | 4913342 |
| achocolatado-gelado | 34035510 |

As fotos da página Sobre ficam em `src/assets/sobre`: balcão (14929940), mãos na massa (5947593) e fornada
(29737490).

## Rodando localmente

Precisa de Node 22.12 ou mais novo.

```bash
npm install
npm run dev      # http://localhost:4321 (modo demonstração se não houver .env)
npm run build    # astro check + build em dist/
npm run preview
```

## Configurando o Supabase

1. Crie um projeto no [Supabase](https://supabase.com) (região South America, São Paulo).
2. Rode as migrations, uma de cada vez e na ordem do nome do arquivo: cole cada arquivo de `supabase/migrations` no
   **SQL Editor** e execute. Elas criam tabelas, funções, políticas, a publicação do Realtime e o cardápio.
3. Em **Authentication > Sign In / Providers**, desligue *Allow new users to sign up*: só a equipe entra no painel.
4. Crie a conta do balcão em **Authentication > Users > Add user** e coloque-a na equipe pelo SQL Editor:

   ```sql
   insert into public.equipe (user_id, nome)
   select id, 'Balcão' from auth.users where email = 'balcao@exemplo.com';
   ```

5. Copie `.env.example` para `.env` e preencha com a URL do projeto (**Project Settings > Data API**) e a chave
   publishable `sb_publishable_...` (**Project Settings > API Keys**). A `anon` legada também funciona. Essa chave é
   pública por natureza; quem decide o que ela pode fazer é a RLS. Nunca use a `secret` nem a `service_role` aqui.
6. Na Vercel, cadastre as mesmas duas variáveis em **Settings > Environment Variables**.
7. Opcional, conta de visitante: crie outro usuário em **Authentication > Users** com um e-mail que não seja de
   ninguém e coloque-o na equipe como visitante:

   ```sql
   insert into public.equipe (user_id, nome, papel)
   select id, 'Visitante', 'visitante' from auth.users where email = 'visitante@exemplo.com';
   ```

   Depois cadastre `PUBLIC_BALCAO_VISITANTE_EMAIL` e `PUBLIC_BALCAO_VISITANTE_SENHA` na Vercel. Essa senha fica
   pública na página de propósito; o que protege os dados é o papel `visitante` no banco.
8. Opcional, movimento de demonstração: rode `supabase/demonstracao.sql` no SQL Editor. Ele cria um dia de pedidos
   realistas (marcados com `demo`, reservando estoque como pedidos de verdade) e encomendas de festa, e pode ser
   agendado todo dia pelo pg_cron para o painel nunca ficar vazio.

## Testes

```bash
npm test           # unitários e do banco (Vitest + jsdom + PGlite)
npm run test:e2e   # ponta a ponta (Playwright): faz o build e sobe o preview sozinho
```

- **Unitários** (`src/**/*.test.ts`): a store da sacola (limites, linhas inválidas, localStorage corrompido ou
  indisponível, sincronização entre abas), totais em centavos, horários de retirada e as regras do sonho montado.
- **Banco** (`supabase/tests`): a migration roda inteira num Postgres em memória ([PGlite](https://pglite.dev)), com
  os papéis `anon` e `authenticated` do Supabase simulados. Cobre: cardápio do banco igual ao do site, o mesmo preço nos
  dois lados para as 168 combinações de sonho, horários válidos, reserva e falta de estoque sem reserva parcial,
  cancelamento devolvendo estoque, os limites (por aparelho, geral e de unidades), o acompanhamento sem dados pessoais
  e as permissões (o público não lê pedidos; a equipe muda o status, mas não o valor). As encomendas de festa têm testes
  próprios (`supabase/tests/encomendas.test.ts`): catálogo igual ao do site, mesmo preço e mesma descrição dos dois
  lados, antecedência, segunda-feira, sabores por kit, limite por aparelho e permissões.
- **Ponta a ponta** (`tests/e2e`), em desktop e celular, com um Supabase falso respondendo pelo `page.route`: sacola e
  recarga, pedido completo (conferindo que só linhas e quantidades são enviadas), estoque na vitrine, produto que esgota
  no meio do pedido, recusa por excesso de pedidos, montador de sonho, a página de acompanhamento (com o relógio do
  Playwright para testar a atualização automática), bebidas e combo, encomenda de festa, página Sobre, filtro, foco,
  animações e a tela de login do balcão.
- **CI**: o GitHub Actions roda `astro check`, os unitários e os testes ponta a ponta em cada push e pull request.

Localmente, o Playwright usa o Chrome já instalado (`channel: 'chrome'`). Na CI, ele instala o Chromium próprio.

## Deploy

Na Vercel, importe o repositório: o preset do Astro é detectado sozinho (build `npm run build`, saída `dist`).

## Estrutura

```
src/
  components/     Header, Hero, Vitrine, Combo, Montador, Festa, Depoimentos, Visite, Footer, CartDrawer, Illustration
  pages/          index.astro (loja), sobre.astro, pedido.astro (acompanhamento), balcao.astro (painel da equipe)
  assets/fotos/   fotos dos produtos (Pexels)
  assets/sobre/   fotos da página Sobre (Pexels)
  data/           menu.ts (cardápio), sonho.ts (opções e preço do sonho), catalog.ts (resolve qualquer linha da sacola),
                  festa.ts (kits e regras das encomendas)
  scripts/        cart-store.ts (estado + localStorage), shop.ts (estoque e "adicionar"), cart-ui.ts (gaveta e
                  checkout), montador.ts, api.ts (RPCs do Supabase), pedido.ts (acompanhamento),
                  balcao.ts (painel), slots.ts (horários), fornadas.ts (próxima fornada), combo.ts, festa.ts
  styles/         global.css (tokens e base), cart.css (gaveta)
supabase/
  migrations/     schema, RLS, funções e dados
  tests/          testes do banco em PGlite
tests/e2e/        Playwright
```

---

Projeto de portfólio de [Samara Caldas](https://github.com/samaracaldas). A Bendita, o endereço, o telefone e os
depoimentos são fictícios.
