import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ActivityStats, Catalog, ConcursoFilter, ConcursoInfo, GradedAnswer, Question, Simulado, StudentProfile, SubjectInfo, User, UserStats } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  catalog(): Observable<Catalog> {
    return this.http.get<Catalog>('api/catalog');
  }

  practiceQuestions(options: { category: string; count: number; subject?: string } & ConcursoFilter): Observable<Question[]> {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== '') params[key] = value;
    return this.http.get<Question[]>('api/practice/questions', { params });
  }

  concursos(): Observable<ConcursoInfo[]> {
    return this.http.get<ConcursoInfo[]>('api/concursos');
  }

  subjects(category?: string): Observable<SubjectInfo[]> {
    return this.http.get<SubjectInfo[]>('api/subjects', { params: category ? { category } : {} });
  }

  submitAnswers(
    answers: { questionId: string; examId: string; selected: string; durationMs?: number }[],
    simulado?: { title: string },
  ): Observable<{ results: GradedAnswer[]; simulado?: Simulado }> {
    return this.http.post<{ results: GradedAnswer[]; simulado?: Simulado }>('api/answers', { answers, simulado });
  }

  stats(category?: string): Observable<UserStats> {
    return this.http.get<UserStats>('api/me/stats', { params: category ? { category } : {} });
  }

  /** Last `days` days (7 or 30), split at the browser's local midnight. */
  activity(days: number, category?: string): Observable<ActivityStats> {
    const params = { days, tz: new Date().getTimezoneOffset(), ...(category ? { category } : {}) };
    return this.http.get<ActivityStats>('api/me/activity', { params });
  }

  profile(): Observable<StudentProfile> {
    return this.http.get<StudentProfile>('api/me/profile', { params: { tz: new Date().getTimezoneOffset() } });
  }

  updateProfile(fields: { bio?: string | null; location?: string | null }): Observable<User> {
    return this.http.patch<User>('api/me', fields);
  }

  deleteAccount(): Observable<void> {
    return this.http.delete<void>('api/me');
  }

  simulados(category?: string, limit = 5): Observable<Simulado[]> {
    return this.http.get<Simulado[]>('api/me/simulados', { params: { limit, ...(category ? { category } : {}) } });
  }
}

/**
 * Question images keep the Flutter asset paths ("assets/images/x.png"). They're
 * resolved against the page's <base href>, so they work both at / (local) and
 * under /concursero-angular/ (Cloudflare).
 */
export function assetUrl(path: unknown): string | null {
  if (typeof path !== 'string' || !path.trim()) return null;
  return path.startsWith('http') ? path : path.replace(/^\/+/, '');
}
