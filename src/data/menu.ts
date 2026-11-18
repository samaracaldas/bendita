export type Category = 'sonhos' | 'salgados' | 'potes' | 'paes' | 'bebidas';
export type Art =
  | 'sonho'
  | 'pao-de-queijo'
  | 'coxinha'
  | 'esfiha'
  | 'pote'
  | 'pao'
  | 'rosca'
  | 'croissant'
  | 'rosquinha'
  | 'xicara'
  | 'copo';

/** Which side of the "sonho + café" combo a product counts as. */
export type ComboRole = 'sonho' | 'cafe';

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Portion shown under the name, e.g. "120 g" or "porção com 6". */
  portion: string;
  /** Price in centavos, to keep the cart math in integers. */
  price: number;
  category: Category;
  art: Art;
  /** Main color of the illustration (filling, frosting, dough). */
  tint: string;
  /** Hot and iced drinks don't travel well: pickup only. */
  pickupOnly?: boolean;
  combo?: ComboRole;
  /** Hours (shop time) when a fresh batch comes out of the oven. */
  fornadas?: number[];
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'sonhos', label: 'Sonhos' },
  { id: 'salgados', label: 'Salgados' },
  { id: 'potes', label: 'Bolos de pote' },
  { id: 'paes', label: 'Pães' },
  { id: 'bebidas', label: 'Bebidas' },
];

export const MENU: Product[] = [
  {
    id: 'sonho-doce-de-leite',
    name: 'Sonho de doce de leite',
    description: 'Massa de fermentação lenta, recheada na hora com doce de leite de tacho.',
    portion: '120 g',
    price: 950,
    category: 'sonhos',
    art: 'sonho',
    tint: '#b8732e',
    combo: 'sonho',
  },
  {
    id: 'sonho-creme',
    name: 'Sonho de creme',
    description: 'O clássico da vitrine: creme de baunilha e muito açúcar por cima.',
    portion: '120 g',
    price: 850,
    category: 'sonhos',
    art: 'sonho',
    tint: '#ffd23f',
    combo: 'sonho',
  },
  {
    id: 'sonho-brigadeiro',
    name: 'Sonho de brigadeiro',
    description: 'Brigadeiro mole com cacau 50% e granulado belga.',
    portion: '130 g',
    price: 1000,
    category: 'sonhos',
    art: 'sonho',
    tint: '#5a2e22',
    combo: 'sonho',
  },
  {
    id: 'sonho-goiabada',
    name: 'Sonho de goiabada',
    description: 'Goiabada cascão derretida com uma pitada de sal.',
    portion: '120 g',
    price: 900,
    category: 'sonhos',
    art: 'sonho',
    tint: '#d9465f',
    combo: 'sonho',
  },
  {
    id: 'pao-de-queijo',
    name: 'Pão de queijo',
    description: 'Queijo canastra meia-cura, assado de hora em hora.',
    portion: 'porção com 6',
    price: 1200,
    category: 'salgados',
    art: 'pao-de-queijo',
    tint: '#f2b544',
    fornadas: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  },
  {
    id: 'coxinha',
    name: 'Coxinha de frango',
    description: 'Frango desfiado com requeijão cremoso e massa de batata.',
    portion: '110 g',
    price: 800,
    category: 'salgados',
    art: 'coxinha',
    tint: '#c9752c',
  },
  {
    id: 'esfiha',
    name: 'Esfiha de carne',
    description: 'Fechada, de massa macia, com carne temperada, limão e hortelã.',
    portion: '90 g',
    price: 750,
    category: 'salgados',
    art: 'esfiha',
    tint: '#a8432a',
    fornadas: [11, 17],
  },
  {
    id: 'croissant-presunto-queijo',
    name: 'Croissant de presunto e queijo',
    description: 'Massa folhada na manteiga, presunto e queijo prato, aquecido na hora.',
    portion: '110 g',
    price: 1400,
    category: 'salgados',
    art: 'croissant',
    tint: '#e9a24c',
    fornadas: [7, 10, 15],
  },
  {
    id: 'pote-morango',
    name: 'Bolo de pote de morango',
    description: 'Pão de ló, chantilly, morango fresco e farofa de castanha por cima.',
    portion: 'pote de 250 ml',
    price: 1400,
    category: 'potes',
    art: 'pote',
    tint: '#e8475f',
  },
  {
    id: 'pote-red-velvet',
    name: 'Bolo de pote red velvet',
    description: 'Massa red velvet, creme de cream cheese e farelo vermelho por cima.',
    portion: 'pote de 250 ml',
    price: 1500,
    category: 'potes',
    art: 'pote',
    tint: '#b3203a',
  },
  {
    id: 'pote-limao',
    name: 'Bolo de pote de limão',
    description: 'Pão de ló, creme de limão siciliano, raspas da casca e uma framboesa por cima.',
    portion: 'pote de 250 ml',
    price: 1400,
    category: 'potes',
    art: 'pote',
    tint: '#f2e27a',
  },
  {
    id: 'pao-de-leite',
    name: 'Pão de leite',
    description: 'Macio, levemente doce, ótimo na chapa com manteiga.',
    portion: 'pacote com 6',
    price: 1200,
    category: 'paes',
    art: 'pao',
    tint: '#e0a35c',
    fornadas: [7, 16],
  },
  {
    id: 'rosca-coco',
    name: 'Rosca de coco',
    description: 'Trançada, com creme de coco e coco em flocos tostado.',
    portion: '500 g',
    price: 2200,
    category: 'paes',
    art: 'rosca',
    tint: '#f7b4c8',
  },
  {
    id: 'rosquinha-nata',
    name: 'Rosquinha de nata',
    description: 'Desmancha na boca, do jeito da vó. Boa para molhar no café.',
    portion: 'pacote com 12',
    price: 1600,
    category: 'paes',
    art: 'rosquinha',
    tint: '#f0c27a',
  },
  {
    id: 'cafe-coado',
    name: 'Café coado',
    description: 'Passado na hora, no coador de pano, com grão torrado no sul de Minas.',
    portion: 'xícara de 150 ml',
    price: 600,
    category: 'bebidas',
    art: 'xicara',
    tint: '#4a2a1e',
    pickupOnly: true,
    combo: 'cafe',
  },
  {
    id: 'pingado',
    name: 'Pingado',
    description: 'Café coado com um bom pingo de leite quente, do jeito de balcão.',
    portion: 'xícara de 190 ml',
    price: 750,
    category: 'bebidas',
    art: 'xicara',
    tint: '#a8673e',
    pickupOnly: true,
    combo: 'cafe',
  },
  {
    id: 'cappuccino',
    name: 'Cappuccino',
    description: 'Espresso, leite vaporizado e espuma cremosa. Canela por cima, se quiser.',
    portion: 'xícara de 180 ml',
    price: 1200,
    category: 'bebidas',
    art: 'xicara',
    tint: '#c98c5a',
    pickupOnly: true,
    combo: 'cafe',
  },
  {
    id: 'achocolatado-gelado',
    name: 'Achocolatado gelado',
    description: 'Leite gelado batido com cacau e calda de chocolate no copo.',
    portion: 'copo de 300 ml',
    price: 1000,
    category: 'bebidas',
    art: 'copo',
    tint: '#7a4630',
    pickupOnly: true,
  },
];

/** Off each sonho + café pair in the bag (centavos). Same value as parametros.desconto_combo. */
export const COMBO_DISCOUNT = 200;

export const DELIVERY_FEE = 700;

export const formatBRL = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
