import { Injectable, signal } from '@angular/core';
import type { ConcursoFilter, ConcursoLevel } from './models';

const STORAGE_KEY = 'brasilquiz.concursoFilter';
const LEVELS: ConcursoLevel[] = ['federal', 'estadual', 'municipal', 'privada'];

/**
 * The Concursos / Vestibulares filters picked on the dashboard, one per category
 * (level → state → município or university → concurso), remembered per browser.
 */
@Injectable({ providedIn: 'root' })
export class ConcursoFilterState {
  private readonly filters = signal<Record<string, ConcursoFilter>>(this.read());

  filter(category: string): ConcursoFilter {
    return this.filters()[category] ?? {};
  }

  /** Changing a level clears what depends on it (a state belongs to a level, a município to a state, ...). */
  setLevel(category: string, level: ConcursoLevel | undefined) {
    this.save(category, level ? { level } : {});
  }

  setUf(category: string, uf: string | undefined) {
    this.save(category, { level: this.filter(category).level, uf });
  }

  setMunicipio(category: string, municipio: string | undefined) {
    const { level, uf } = this.filter(category);
    this.save(category, { level, uf, municipio });
  }

  setInstitution(category: string, institution: string | undefined) {
    const { level, uf } = this.filter(category);
    this.save(category, { level, uf, institution });
  }

  setConcurso(category: string, concurso: string | undefined) {
    this.save(category, { ...this.filter(category), concurso });
  }

  private save(category: string, filter: ConcursoFilter) {
    const clean = Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) as ConcursoFilter;
    this.filters.update((all) => ({ ...all, [category]: clean }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.filters()));
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
  }

  private read(): Record<string, ConcursoFilter> {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, ConcursoFilter>;
      // Before Vestibulares existed the Concursos filter was stored on its own.
      if ('level' in stored || 'concurso' in stored) return { CONCURSOS: stored as ConcursoFilter };
      for (const filter of Object.values(stored)) if (filter.level && !LEVELS.includes(filter.level)) return {};
      return stored;
    } catch {
      return {};
    }
  }
}

/** Query params for /app/praticar (and the practice API): only the fields that are set. */
export function filterParams(filter: ConcursoFilter): Record<string, string> {
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) as Record<string, string>;
}
