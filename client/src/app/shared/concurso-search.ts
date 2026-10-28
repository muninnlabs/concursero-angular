import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, filter, of, switchMap, take } from 'rxjs';
import { ApiService } from '../core/api.service';
import { CATEGORIES } from '../core/categories';
import { matchesSearch } from '../core/search';
import { Icon } from './icon';

interface Hit {
  id: string;
  name: string;
  detail: string;
  category: string;
  /** null: the whole category (ENEM, OAB), which has no concurso list. */
  concurso: string | null;
}

const MAX_HITS = 8;

/** ENEM and OAB are one exam each, found by their own names. */
const WHOLE_CATEGORIES: Hit[] = [
  { id: 'ENEM', name: 'ENEM', detail: 'Exame Nacional do Ensino Médio', category: 'ENEM', concurso: null },
  { id: 'OAB', name: 'Exame da OAB', detail: 'Ordem dos Advogados do Brasil', category: 'OAB', concurso: null },
];

/**
 * The top bar's "Buscar concursos" box: finds a concurso, vestibular, hospital
 * (residência) or ENEM/OAB by name, institution, state or year and opens a
 * Mini Simulado of it. The list is fetched on first focus.
 */
@Component({
  selector: 'app-concurso-search',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'concurso-search',
    '(document:click)': 'closeOutside($event)',
    '(keydown.escape)': 'open.set(false)',
  },
  template: `
    <label class="search">
      <app-icon name="search" [size]="17" />
      <span class="sr-only">Buscar concursos</span>
      <input
        type="search"
        placeholder="Buscar concursos, vestibulares, hospitais..."
        role="combobox"
        aria-controls="concurso-search-list"
        [attr.aria-expanded]="showList()"
        [attr.aria-activedescendant]="showList() && hits().length ? 'concurso-hit-' + active() : null"
        autocomplete="off"
        [value]="query()"
        (focus)="wanted.set(true); open.set(true)"
        (input)="query.set($any($event.target).value); active.set(0); open.set(true)"
        (keydown.arrowdown)="move(1, $event)"
        (keydown.arrowup)="move(-1, $event)"
        (keydown.enter)="pick(hits()[active()])"
      />
    </label>
    @if (showList()) {
      <ul id="concurso-search-list" class="card list" role="listbox">
        @for (hit of hits(); track hit.id; let i = $index) {
          <li
            [id]="'concurso-hit-' + i"
            role="option"
            [attr.aria-selected]="i === active()"
            [class.active]="i === active()"
            (mouseenter)="active.set(i)"
            (mousedown)="$event.preventDefault()"
            (click)="pick(hit)"
          >
            <span class="hit">
              <strong>{{ hit.name }}</strong>
              <small>{{ hit.detail }}</small>
            </span>
            <span class="tag">{{ categoryLabel(hit.category) }}</span>
          </li>
        } @empty {
          <li class="empty">{{ concursos() ? 'Nenhum concurso encontrado.' : 'Carregando…' }}</li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      width: min(372px, 100%);
    }
    /* Same box as the pages' own search in the shell's top bar. */
    .search {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 42px;
      padding: 0 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text-subtle);
      background: var(--background);
      input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--text);
        outline: none;
        &::placeholder {
          color: var(--text-subtle);
        }
      }
    }
    .list {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      z-index: 30;
      display: grid;
      max-height: min(420px, 70vh);
      overflow-y: auto;
      margin: 0;
      padding: 6px;
      list-style: none;
      box-shadow: var(--shadow-md);
    }
    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 10px;
      border-radius: 8px;
      cursor: pointer;
    }
    li.active {
      background: var(--background);
    }
    .hit {
      display: grid;
      min-width: 0;
      strong,
      small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      strong {
        color: var(--text);
        font-size: 14px;
      }
      small {
        color: var(--text-subtle);
        font-size: 12px;
      }
    }
    .tag {
      flex: none;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
    }
    .empty {
      color: var(--text-subtle);
      font-size: 13px;
      cursor: default;
    }
  `,
})
export class ConcursoSearch {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  /** Set on first focus, so the list isn't fetched for every page view. */
  protected readonly wanted = signal(false);

  protected readonly concursos = toSignal(
    toObservable(this.wanted).pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.api.concursos()),
      catchError(() => of([])),
    ),
  );

  protected readonly hits = computed<Hit[]>(() => {
    const words = this.query().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const all: Hit[] = [
      ...WHOLE_CATEGORIES,
      ...(this.concursos() ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        detail: [c.institution, c.municipio, c.uf].filter(Boolean).join(' · '),
        category: c.category,
        concurso: c.id,
      })),
    ];
    // Every word has to appear somewhere: "hcpa 2025", "pm sc", "residencia unifesp".
    return all
      .filter((hit) => {
        const text = `${hit.name} ${hit.detail} ${this.categoryLabel(hit.category)}`;
        return words.every((word) => matchesSearch(text, word));
      })
      .slice(0, MAX_HITS);
  });

  protected readonly showList = computed(() => this.open() && this.query().trim() !== '');

  protected categoryLabel(id: string) {
    return CATEGORIES.find((c) => c.id === id)?.label ?? id;
  }

  protected move(delta: number, event: Event) {
    event.preventDefault();
    const count = this.hits().length;
    if (count) this.active.set((this.active() + delta + count) % count);
  }

  protected pick(hit: Hit | undefined) {
    if (!hit) return;
    this.open.set(false);
    this.query.set('');
    this.router.navigate(['/app/praticar'], {
      queryParams: { modo: 'mini', categoria: hit.category, ...(hit.concurso ? { concurso: hit.concurso } : {}) },
    });
  }

  protected closeOutside(event: Event) {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
