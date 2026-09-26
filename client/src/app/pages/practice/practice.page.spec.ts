import { dewrap } from './practice.page';

describe('dewrap', () => {
  it('joins PDF line wraps but keeps paragraph breaks', () => {
    expect(dewrap('Antônia, advogada\natuante na área.\n\nNovo parágrafo')).toBe('Antônia, advogada atuante na área.\n\nNovo parágrafo');
  });

  it('handles missing text', () => {
    expect(dewrap(null)).toBe('');
  });
});
