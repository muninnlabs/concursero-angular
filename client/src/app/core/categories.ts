import { Injectable, signal } from '@angular/core';

export interface CategoryOption {
  id: string;
  label: string;
  /** False until there's exam data for it in assets/provas. */
  available: boolean;
}

export const CATEGORIES: CategoryOption[] = [
  { id: 'ENEM', label: 'ENEM', available: true },
  { id: 'OAB', label: 'OAB', available: true },
  { id: 'CONCURSOS', label: 'Concursos', available: false },
  { id: 'VESTIBULARES', label: 'Vestibulares', available: false },
];

const STORAGE_KEY = 'brasilquiz.category';

/** The exam type picked on the dashboard, remembered per browser. */
@Injectable({ providedIn: 'root' })
export class CategoryState {
  readonly selected = signal(this.read());

  select(id: string) {
    this.selected.set(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
  }

  private read(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (CATEGORIES.some((c) => c.id === stored && c.available)) return stored!;
    } catch {
      // Fall through to the default.
    }
    return 'ENEM';
  }
}
