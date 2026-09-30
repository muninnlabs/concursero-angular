import { Injectable, signal } from '@angular/core';

/**
 * The top bar's search box. Pages that support it declare `search` (the
 * placeholder) in their route data and filter by `query`; it's cleared on
 * every navigation.
 */
@Injectable({ providedIn: 'root' })
export class SearchState {
  readonly query = signal('');
}

/** Case- and accent-insensitive "contains". */
export function matchesSearch(text: string, query: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return fold(text).includes(fold(query.trim()));
}
