import { describe, expect, it } from 'vitest';
import { resolveLine } from './catalog';
import { SONHO_PADRAO, parseSonhoKey, sonhoDescricao, sonhoKey, sonhoPreco } from './sonho';

describe('sonho montado', () => {
  it('o mesmo sonho tem sempre a mesma chave, em qualquer ordem de recheio', () => {
    const a = sonhoKey({ massa: 'brioche', recheios: ['goiabada', 'creme'], cobertura: 'canela' });
    const b = sonhoKey({ massa: 'brioche', recheios: ['creme', 'goiabada'], cobertura: 'canela' });
    expect(a).toBe('montado|brioche|creme+goiabada|canela');
    expect(b).toBe(a);
  });

  it('lê de volta a chave que gerou', () => {
    const config = { massa: 'tradicional', recheios: ['avela', 'frutas-vermelhas'], cobertura: 'granulado' } as const;
    expect(parseSonhoKey(sonhoKey({ ...config, recheios: [...config.recheios] }))).toEqual(config);
  });

  it('recusa chaves inválidas', () => {
    for (const key of [
      'sonho-creme',
      'montado|tradicional|goiabada+creme|acucar',
      'montado|tradicional|creme+creme|acucar',
      'montado|tradicional|creme+goiabada+avela|acucar',
      'montado|tradicional||acucar',
      'montado|creme|creme|acucar',
      'montado|tradicional|creme',
    ]) {
      expect(parseSonhoKey(key), key).toBeNull();
    }
  });

  it('soma base, acréscimos e meio a meio', () => {
    expect(sonhoPreco(SONHO_PADRAO)).toBe(900);
    // 900 + brioche 100 + avelã 200 + granulado 50 + meio a meio 100
    expect(sonhoPreco({ massa: 'brioche', recheios: ['avela', 'creme'], cobertura: 'granulado' })).toBe(1350);
  });

  it('descreve o sonho em português', () => {
    expect(sonhoDescricao({ massa: 'brioche', recheios: ['creme', 'goiabada'], cobertura: 'sem' })).toBe(
      'Meio a meio: creme e goiabada, massa brioche, sem cobertura',
    );
  });

  it('entra na sacola como uma linha do catálogo', () => {
    const line = resolveLine('montado|tradicional|brigadeiro|granulado');
    expect(line).toMatchObject({ productId: 'sonho-montado', name: 'Sonho do seu jeito', price: 950 });
    expect(resolveLine('montado|x|y|z')).toBeNull();
  });
});
