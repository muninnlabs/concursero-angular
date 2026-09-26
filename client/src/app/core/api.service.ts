import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Catalog, GradedAnswer, Question, Simulado, UserStats } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  catalog(): Observable<Catalog> {
    return this.http.get<Catalog>('/api/catalog');
  }

  practiceQuestions(options: { category: string; count: number; subject?: string }): Observable<Question[]> {
    const params: Record<string, string | number> = { category: options.category, count: options.count };
    if (options.subject) params['subject'] = options.subject;
    return this.http.get<Question[]>('/api/practice/questions', { params });
  }

  submitAnswers(
    answers: { questionId: string; selected: string }[],
    simulado?: { title: string },
  ): Observable<{ results: GradedAnswer[]; simulado?: Simulado }> {
    return this.http.post<{ results: GradedAnswer[]; simulado?: Simulado }>('/api/answers', { answers, simulado });
  }

  stats(category?: string): Observable<UserStats> {
    return this.http.get<UserStats>('/api/me/stats', { params: category ? { category } : {} });
  }

  simulados(category?: string, limit = 5): Observable<Simulado[]> {
    return this.http.get<Simulado[]>('/api/me/simulados', { params: { limit, ...(category ? { category } : {}) } });
  }
}

/** Question images keep the Flutter asset paths ("assets/images/x.png"); the API serves them. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('/') || path.startsWith('http') ? path : `/${path}`;
}
