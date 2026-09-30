import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Badge, RankingEntry, Simulado, StudentProfile } from '../../core/models';
import { Icon, type IconName } from '../../shared/icon';

interface HeatCell {
  day: string;
  count: number;
  /** 0 (nothing) to 4 (20+ questions). */
  level: number;
  future: boolean;
}

const WEEKS = 26;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

@Component({
  selector: 'app-profile-page',
  imports: [RouterLink, Icon],
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly profile = rxResource({ stream: () => this.api.profile() });

  protected readonly allSimulados = signal(false);
  protected readonly simulados = rxResource({
    params: () => (this.allSimulados() ? 50 : 4),
    stream: ({ params }) => this.api.simulados(undefined, params),
  });

  protected readonly fullRanking = signal(false);

  // "Sobre" editing
  protected readonly editing = signal(false);
  protected readonly bioDraft = signal('');
  protected readonly locationDraft = signal('');
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly shareMessage = signal<string | null>(null);

  private readonly heatmapScroll = viewChild<ElementRef<HTMLElement>>('heatmapScroll');

  constructor() {
    // On narrow screens the grid scrolls: start at the most recent weeks.
    afterRenderEffect(() => {
      const el = this.heatmapScroll()?.nativeElement;
      if (el && this.heatmap().weeks.length) el.scrollLeft = el.scrollWidth;
    });
  }

  protected readonly user = computed(() => this.profile.value()?.user ?? this.auth.user());
  protected readonly firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');

  protected readonly initials = computed(() =>
    (this.user()?.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  );

  protected readonly levelProgress = computed(() => {
    const p = this.profile.value();
    if (!p) return 0;
    const { levelXp, nextLevelXp } = p.level;
    return ((p.xp - levelXp) / (nextLevelXp - levelXp)) * 100;
  });

  /** GitHub-style grid: one column per week (Sunday first), the current week last. */
  protected readonly heatmap = computed(() => {
    const p = this.profile.value();
    if (!p) return { weeks: [] as HeatCell[][], months: [] as { label: string; column: number }[] };

    const counts = new Map(p.activity.map((a) => [a.day, a.count]));
    const today = utcDate(p.today);
    const start = utcDate(p.today);
    start.setUTCDate(start.getUTCDate() - today.getUTCDay() - (WEEKS - 1) * 7);

    const weeks: HeatCell[][] = [];
    const months: { label: string; column: number }[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const week: HeatCell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + w * 7 + d);
        const day = date.toISOString().slice(0, 10);
        const count = counts.get(day) ?? 0;
        week.push({ day, count, level: heatLevel(count), future: date > today });
        // Month label over the first week that starts in that month.
        if (d === 0 && (w === 0 || date.getUTCDate() <= 7)) months.push({ label: MONTHS[date.getUTCMonth()], column: w });
      }
      weeks.push(week);
    }
    // Drop a first label that would collide with the next one.
    if (months.length > 1 && months[1].column - months[0].column < 3) months.shift();
    return { weeks, months };
  });

  /** Days practised since Monday of the current week. */
  protected readonly daysThisWeek = computed(() => {
    const p = this.profile.value();
    if (!p) return 0;
    const monday = utcDate(p.today);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const from = monday.toISOString().slice(0, 10);
    return p.activity.filter((a) => a.day >= from).length;
  });

  protected readonly unlockedCount = computed(() => this.profile.value()?.badges.filter((b) => b.unlocked).length ?? 0);

  /** The user and their neighbours, or the whole list the API sent (top 10 + neighbours). */
  protected readonly rankingRows = computed(() => {
    const entries = this.profile.value()?.ranking.entries ?? [];
    const you = entries.find((e) => e.you);
    const rows = this.fullRanking() || !you ? entries : entries.filter((e) => Math.abs(e.position - you.position) <= 1);
    // Mark gaps in the positions (e.g. #10 → #24) so the list doesn't look contiguous.
    return rows.map((entry, i) => ({ entry, gapBefore: i > 0 && entry.position - rows[i - 1].position > 1 }));
  });

  protected formatXp(xp: number): string {
    return xp >= 10_000
      ? new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(xp)
      : xp.toLocaleString('pt-BR');
  }

  protected rankInitials(entry: RankingEntry): string {
    return entry.name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  protected badgeIcon(badge: Badge): IconName {
    return badge.icon as IconName;
  }

  protected cellTitle(cell: HeatCell): string {
    const date = utcDate(cell.day).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    if (cell.count === 0) return `Nenhuma questão em ${date}`;
    return `${cell.count} ${cell.count === 1 ? 'questão' : 'questões'} em ${date}`;
  }

  protected simuladoDate(simulado: Simulado): string {
    return new Date(simulado.finishedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  protected score(simulado: Simulado): number {
    return simulado.total ? Math.round((simulado.correct / simulado.total) * 100) : 0;
  }

  protected startEditing() {
    this.bioDraft.set(this.user()?.bio ?? '');
    this.locationDraft.set(this.user()?.location ?? '');
    this.saveError.set(null);
    this.editing.set(true);
  }

  protected save() {
    this.saving.set(true);
    this.saveError.set(null);
    this.api.updateProfile({ bio: this.bioDraft(), location: this.locationDraft() }).subscribe({
      next: (user) => {
        this.saving.set(false);
        this.editing.set(false);
        this.auth.user.set(user);
        this.profile.update((p) => p && ({ ...p, user }) satisfies StudentProfile);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set((err instanceof HttpErrorResponse && err.error?.error) || 'Não foi possível salvar. Tente de novo.');
      },
    });
  }

  protected async share() {
    const p = this.profile.value();
    if (!p) return;
    const text = `Estou no nível ${p.level.level} do BrasilQuiz, com ${p.streak.current} ${p.streak.current === 1 ? 'dia' : 'dias'} de ofensiva e ${p.xp.toLocaleString('pt-BR')} XP. Bora estudar também?`;
    const url = document.baseURI;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BrasilQuiz', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.flash('Texto copiado para a área de transferência.');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') this.flash('Não foi possível compartilhar agora.');
    }
  }

  private flash(message: string) {
    this.shareMessage.set(message);
    setTimeout(() => this.shareMessage.set(null), 3000);
  }
}

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function heatLevel(count: number): number {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}
