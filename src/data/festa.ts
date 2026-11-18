/**
 * Party orders: sold by the hundred ("cento"), booked at least two days ahead.
 * Same data as the kits_festa and sabores_festa tables (a test checks both agree).
 */

export interface Sabor {
  id: string;
  nome: string;
}

export interface Kit {
  id: string;
  nome: string;
  nota: string;
  /** Price per cento, in centavos. */
  preco: number;
  /** 0 = no flavor choice. Otherwise pick between 1 and this many. */
  maxSabores: number;
  sabores: Sabor[];
}

export const KITS: Kit[] = [
  {
    id: 'salgados',
    nome: 'Salgados mistos',
    nota: 'fritos na hora da retirada',
    preco: 9500,
    maxSabores: 3,
    sabores: [
      { id: 'coxinha', nome: 'coxinha' },
      { id: 'risoles', nome: 'risoles' },
      { id: 'bolinha-queijo', nome: 'bolinha de queijo' },
      { id: 'esfiha', nome: 'mini esfiha' },
    ],
  },
  {
    id: 'docinhos',
    nome: 'Docinhos de festa',
    nota: 'em forminha, prontos para a mesa',
    preco: 12000,
    maxSabores: 3,
    sabores: [
      { id: 'brigadeiro', nome: 'brigadeiro' },
      { id: 'beijinho', nome: 'beijinho' },
      { id: 'bicho-de-pe', nome: 'bicho-de-pé' },
      { id: 'cajuzinho', nome: 'cajuzinho' },
    ],
  },
  {
    id: 'mini-sonhos',
    nome: 'Mini sonhos',
    nota: 'recheados na hora',
    preco: 16000,
    maxSabores: 2,
    sabores: [
      { id: 'doce-de-leite', nome: 'doce de leite' },
      { id: 'creme', nome: 'creme' },
      { id: 'goiabada', nome: 'goiabada' },
      { id: 'brigadeiro', nome: 'brigadeiro' },
    ],
  },
  {
    id: 'pao-de-queijo',
    nome: 'Pão de queijo coquetel',
    nota: 'congelado, para assar em casa',
    preco: 6500,
    maxSabores: 0,
    sabores: [],
  },
];

/** Party delivery costs more than a regular one: bigger boxes, a car instead of a bike. */
export const TAXA_ENTREGA_FESTA = 1500;
export const MAX_CENTOS = 10;
/** Days of notice, counted in São Paulo dates. */
export const ANTECEDENCIA_DIAS = 2;
export const ATE_DIAS = 60;

export type Periodo = 'manha' | 'tarde';
export const PERIODOS: { id: Periodo; nome: string }[] = [
  { id: 'manha', nome: 'Manhã, das 8h às 12h' },
  { id: 'tarde', nome: 'Tarde, das 14h às 18h' },
];

export interface ItemFesta {
  kit: string;
  quantidade: number;
  sabores: string[];
}

export const kitById = (id: string) => KITS.find((k) => k.id === id);

/** Problems with one line, or null when it is fine. */
export function validarItem(item: ItemFesta): 'kit' | 'quantidade' | 'sabores' | null {
  const kit = kitById(item.kit);
  if (!kit) return 'kit';
  if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > MAX_CENTOS) return 'quantidade';
  const unicos = new Set(item.sabores);
  if (unicos.size !== item.sabores.length) return 'sabores';
  const min = kit.maxSabores > 0 ? 1 : 0;
  if (item.sabores.length < min || item.sabores.length > kit.maxSabores) return 'sabores';
  if (!item.sabores.every((s) => kit.sabores.some((o) => o.id === s))) return 'sabores';
  return null;
}

export function totaisFesta(itens: ItemFesta[], tipo: 'retirada' | 'entrega') {
  const subtotal = itens.reduce((sum, i) => sum + (kitById(i.kit)?.preco ?? 0) * i.quantidade, 0);
  const taxa = subtotal > 0 && tipo === 'entrega' ? TAXA_ENTREGA_FESTA : 0;
  return { subtotal, taxa, total: subtotal + taxa };
}

/** "Mini sonhos: doce de leite e creme". Flavors keep the kit's order, like the database. */
export function descricaoItem(item: ItemFesta) {
  const kit = kitById(item.kit)!;
  const nomes = kit.sabores.filter((s) => item.sabores.includes(s.id)).map((s) => s.nome);
  if (nomes.length === 0) return kit.nome;
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0];
  return `${kit.nome}: ${lista}`;
}

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

/** Earliest and latest party dates as YYYY-MM-DD, counted from today in São Paulo. */
export function janelaDatas(now: Date) {
  const hoje = new Date(`${ymd(now)}T12:00:00Z`);
  const add = (n: number) => new Date(hoje.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { min: add(ANTECEDENCIA_DIAS), max: add(ATE_DIAS) };
}

/** Why a date can't be booked, or null. Mondays are closed. */
export function validarData(dia: string, now: Date): 'cedo' | 'longe' | 'segunda' | 'invalida' | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T12:00:00Z`))) return 'invalida';
  const { min, max } = janelaDatas(now);
  if (dia < min) return 'cedo';
  if (dia > max) return 'longe';
  if (new Date(`${dia}T12:00:00Z`).getUTCDay() === 1) return 'segunda';
  return null;
}

/** Digits only; Brazilian numbers have 10 (landline) or 11 (mobile) with the area code. */
export const limparTelefone = (t: string) => t.replace(/\D/g, '');
export const telefoneValido = (t: string) => /^\d{10,11}$/.test(limparTelefone(t));
