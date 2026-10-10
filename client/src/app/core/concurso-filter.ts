import { Injectable, signal } from '@angular/core';
import type { ConcursoFilter, ConcursoLevel } from './models';

const STORAGE_KEY = 'brasilquiz.concursoFilter';
const LEVELS: ConcursoLevel[] = ['federal', 'estadual', 'municipal'];

/** The Concursos filter picked on the dashboard (level → state → município → concurso), remembered per browser. */
@Injectable({ providedIn: 'root' })
export class ConcursoFilterState {
  readonly filter = signal<ConcursoFilter>(this.read());

  /** Changing a level clears what depends on it (a state belongs to a level, a município to a state, ...). */
  setLevel(level: ConcursoLevel | undefined) {
    this.save(level ? { level } : {});
  }

  setUf(uf: string | undefined) {
    this.save({ level: this.filter().level, uf });
  }

  setMunicipio(municipio: string | undefined) {
    const { level, uf } = this.filter();
    this.save({ level, uf, municipio });
  }

  setConcurso(concurso: string | undefined) {
    this.save({ ...this.filter(), concurso });
  }

  private save(filter: ConcursoFilter) {
    const clean = Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) as ConcursoFilter;
    this.filter.set(clean);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
  }

  private read(): ConcursoFilter {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ConcursoFilter;
      if (stored.level && !LEVELS.includes(stored.level)) return {};
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
