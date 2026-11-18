import { describe, expect, it } from 'vitest';
import { descricaoItem, janelaDatas, telefoneValido, totaisFesta, validarData, validarItem } from './festa';

// Tuesday 17/11/2026, 21h in São Paulo (00h on the 18th in UTC).
const agora = new Date('2026-11-17T21:00:00-03:00');

describe('datas de festa', () => {
  it('conta a antecedência em dias de São Paulo', () => {
    expect(janelaDatas(agora)).toEqual({ min: '2026-11-19', max: '2027-01-16' });
  });

  it('explica por que uma data não serve', () => {
    expect(validarData('2026-11-18', agora)).toBe('cedo');
    expect(validarData('2026-11-19', agora)).toBeNull();
    expect(validarData('2026-11-23', agora)).toBe('segunda');
    expect(validarData('2027-02-01', agora)).toBe('longe');
    expect(validarData('', agora)).toBe('invalida');
  });
});

describe('itens de festa', () => {
  it('respeita o número de sabores de cada kit', () => {
    expect(validarItem({ kit: 'mini-sonhos', quantidade: 1, sabores: ['creme', 'goiabada'] })).toBeNull();
    expect(validarItem({ kit: 'mini-sonhos', quantidade: 1, sabores: ['creme', 'goiabada', 'brigadeiro'] })).toBe('sabores');
    expect(validarItem({ kit: 'mini-sonhos', quantidade: 1, sabores: [] })).toBe('sabores');
    expect(validarItem({ kit: 'pao-de-queijo', quantidade: 1, sabores: [] })).toBeNull();
    expect(validarItem({ kit: 'salgados', quantidade: 11, sabores: ['coxinha'] })).toBe('quantidade');
    expect(validarItem({ kit: 'bolo', quantidade: 1, sabores: [] })).toBe('kit');
  });

  it('descreve os sabores na ordem do cardápio', () => {
    expect(descricaoItem({ kit: 'salgados', quantidade: 1, sabores: ['esfiha', 'coxinha', 'risoles'] })).toBe(
      'Salgados mistos: coxinha, risoles e mini esfiha',
    );
    expect(descricaoItem({ kit: 'pao-de-queijo', quantidade: 2, sabores: [] })).toBe('Pão de queijo coquetel');
  });

  it('soma por cento e cobra a entrega de festa', () => {
    const itens = [{ kit: 'docinhos', quantidade: 2, sabores: ['beijinho'] }];
    expect(totaisFesta(itens, 'retirada')).toEqual({ subtotal: 24000, taxa: 0, total: 24000 });
    expect(totaisFesta(itens, 'entrega')).toEqual({ subtotal: 24000, taxa: 1500, total: 25500 });
  });

  it('aceita telefone com DDD, com ou sem máscara', () => {
    expect(telefoneValido('(11) 98888-7777')).toBe(true);
    expect(telefoneValido('1133334444')).toBe(true);
    expect(telefoneValido('98888-7777')).toBe(false);
  });
});
