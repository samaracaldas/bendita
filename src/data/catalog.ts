import { MENU, type Art, type ComboRole, type Product } from './menu';
import { SONHO_MONTADO_ID, parseSonhoKey, sonhoDescricao, sonhoPreco, opcao } from './sonho';

/** Everything the bag needs to show and price one line. */
export interface Line {
  key: string;
  /** Product whose daily stock this line consumes. */
  productId: string;
  name: string;
  detail: string;
  price: number;
  art: Art;
  tint: string;
  pickupOnly: boolean;
  combo?: ComboRole;
}

const menuById = new Map<string, Product>(MENU.map((p) => [p.id, p]));

/** Resolves a cart line key: a menu product id or a `montado|…` sonho. Null if invalid. */
export function resolveLine(key: string): Line | null {
  const product = menuById.get(key);
  if (product) {
    return {
      key,
      productId: product.id,
      name: product.name,
      detail: product.portion,
      price: product.price,
      art: product.art,
      tint: product.tint,
      pickupOnly: product.pickupOnly ?? false,
      combo: product.combo,
    };
  }
  const sonho = parseSonhoKey(key);
  if (sonho) {
    return {
      key,
      productId: SONHO_MONTADO_ID,
      name: 'Sonho do seu jeito',
      detail: sonhoDescricao(sonho),
      price: sonhoPreco(sonho),
      art: 'sonho',
      tint: opcao(sonho.recheios[0])!.cor,
      pickupOnly: false,
      combo: 'sonho',
    };
  }
  return null;
}

export const isValidLine = (key: string) => resolveLine(key) !== null;
