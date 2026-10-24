import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { CATEGORIES } from '../../core/categories';
import { Icon, type IconName } from '../../shared/icon';
import { LineChart, type ChartSeries } from '../../shared/line-chart';
import { AdminApi, type AdminReport, type PlacementSetting } from './admin-api';

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 365, label: '12 meses' },
];
const DEVICES: Record<string, string> = { mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet' };
const PAGES: Record<string, string> = {
  '/': 'Página inicial',
  '/entrar': 'Entrar',
  '/app': 'Início',
  '/app/praticar': 'Praticar',
  '/app/assuntos': 'Assuntos',
  '/app/estatisticas': 'Estatísticas',
  '/app/perfil': 'Perfil',
  '/app/configuracoes': 'Configurações',
  '/ajuda': 'Ajuda',
  '/sobre': 'Sobre',
  '/contato': 'Contato',
  '/privacidade': 'Privacidade',
  '/termos': 'Termos',
};

interface Row {
  label: string;
  detail?: string;
  value: number;
  extra?: string;
}

interface Table {
  title: string;
  icon: IconName;
  rows: Row[];
}

const countryNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const number = (n: number) => n.toLocaleString('pt-BR');
const country = (code: string | null) => {
  if (!code || code === 'XX' || code === 'T1') return 'Desconhecido';
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/** "Visão geral": audience, content and ad numbers, the base for selling ad space. */
@Component({
  selector: 'app-admin-overview',
  imports: [Icon, LineChart],
  templateUrl: './admin-overview.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverview {
  private readonly api = inject(AdminApi);
  /** Placement names, from the Anúncios tab's data. */
  readonly placements = input<PlacementSetting[]>([]);

  protected readonly periods = PERIODS;
  protected readonly days = signal(30);
  protected readonly copied = signal(false);
  protected readonly report = rxResource({ params: () => this.days(), stream: ({ params }) => this.api.report(params) });

  protected readonly kpis = computed(() => {
    const r = this.report.value();
    if (!r) return [];
    const delta = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null);
    const kpis: { icon: IconName; tone: string; value: string; label: string; delta?: number | null; hint?: string }[] = [
      { icon: 'users', tone: 'indigo', value: number(r.totals.visitors), label: 'Visitantes', delta: delta(r.totals.visitors, r.previous.visitors), hint: 'Únicos por dia, somados no período' },
      { icon: 'file-text', tone: 'blue', value: number(r.totals.views), label: 'Páginas vistas', delta: delta(r.totals.views, r.previous.views) },
      { icon: 'user', tone: 'green', value: number(r.users.created), label: 'Contas novas' },
      { icon: 'target', tone: 'orange', value: number(r.users.active), label: 'Estudantes ativos', hint: 'Responderam questões no período' },
      { icon: 'crown', tone: 'amber', value: number(r.users.subscribers), label: 'Assinantes' },
      { icon: 'key', tone: 'purple', value: number(r.users.codePremium), label: 'Premium por código' },
    ];
    return kpis;
  });

  protected readonly chart = computed(() => {
    const r = this.report.value();
    if (!r) return null;
    // Every day of the period, zeros included.
    const byDay = new Map(r.daily.map((d) => [d.day, d]));
    const days: string[] = [];
    for (let d = new Date(`${r.from}T12:00:00Z`); d.toISOString().slice(0, 10) <= r.to; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
    const dates = days.map((d) => new Date(`${d}T12:00:00Z`));
    const series: ChartSeries[] = [
      { label: 'Visitantes', color: 'var(--primary)', values: days.map((d) => byDay.get(d)?.visitors ?? 0) },
      { label: 'Páginas vistas', color: 'var(--series-correct)', values: days.map((d) => byDay.get(d)?.views ?? 0) },
    ];
    return {
      labels: dates.map((d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })),
      fullLabels: dates.map((d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })),
      series,
    };
  });

  protected readonly tables = computed(() => {
    const r = this.report.value();
    if (!r) return [];
    const visitors = (rows: { visitors: number }[]) => rows.reduce((n, x) => n + x.visitors, 0) || 1;
    const share = (value: number, total: number) => `${Math.round((value / total) * 100)}%`;
    const category = (id: string | null) => CATEGORIES.find((c) => c.id === id)?.label ?? id ?? '';
    const deviceTotal = visitors(r.devices);
    const tables: Table[] = [
      { title: 'Páginas mais vistas', icon: 'file-text', rows: r.pages.map((p) => ({ label: PAGES[p.path] ?? p.path, detail: PAGES[p.path] ? p.path : undefined, value: p.visitors, extra: `${number(p.views)} vistas` })) },
      { title: 'Conteúdo mais visto', icon: 'book-open', rows: r.content.map((c) => ({ label: c.content, value: c.visitors, extra: `${number(c.views)} vistas` })) },
      { title: 'Provas mais praticadas', icon: 'list-checks', rows: r.exams.map((e) => ({ label: e.label, detail: category(e.category), value: e.answers, extra: `${number(e.students)} estudantes` })) },
      { title: 'Respostas por categoria', icon: 'layers', rows: r.practice.map((p) => ({ label: category(p.category), value: p.answers, extra: `${number(p.students)} estudantes` })) },
      { title: 'Países', icon: 'globe', rows: r.countries.map((c) => ({ label: country(c.country), value: c.visitors })) },
      { title: 'Estados / regiões', icon: 'map-pin', rows: r.regions.map((c) => ({ label: c.region ?? '—', detail: country(c.country), value: c.visitors })) },
      { title: 'Cidades', icon: 'building', rows: r.cities.map((c) => ({ label: c.city ?? '—', detail: [c.region, country(c.country)].filter(Boolean).join(', '), value: c.visitors })) },
      { title: 'De onde vêm', icon: 'share', rows: r.referrers.map((x) => ({ label: x.referrer || 'Acesso direto', detail: x.referrer ? undefined : 'link digitado, favorito ou app', value: x.visitors })) },
      { title: 'Campanhas (utm)', icon: 'flag', rows: r.campaigns.map((x) => ({ label: x.source, detail: x.campaign ?? undefined, value: x.visitors })) },
      { title: 'Dispositivos', icon: 'smartphone', rows: r.devices.map((d) => ({ label: DEVICES[d.device] ?? d.device, value: d.visitors, extra: share(d.visitors, deviceTotal) })) },
    ];
    return tables.map((t) => ({ ...t, max: Math.max(1, ...t.rows.map((row) => row.value)) }));
  });

  /** Views and clicks per ad space; the CTR is what partners ask about. */
  protected readonly ads = computed(() => {
    const r = this.report.value();
    if (!r) return [];
    const names = new Map(this.placements().map((p) => [p.placement, p.label]));
    return r.ads.map((a) => ({
      label: names.get(a.placement) ?? a.placement,
      source: a.source === 'partner' ? 'Parceiro' : 'Google',
      views: number(a.views),
      clicks: a.source === 'partner' ? number(a.clicks) : '—',
      ctr: a.source === 'partner' && a.views ? `${((a.clicks / a.views) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—',
    }));
  });

  /** Plain-text summary to paste in a proposal to a university or school. */
  protected async copySummary() {
    const r = this.report.value();
    if (!r) return;
    const period = PERIODS.find((p) => p.days === r.days)?.label ?? `${r.days} dias`;
    const top = (rows: { label: string; value: number }[], n = 5) => rows.slice(0, n).map((x) => `${x.label} (${number(x.value)})`).join(', ');
    const t = this.tables();
    const lines = [
      `Concursero · audiência dos últimos ${period} (${r.from.split('-').reverse().join('/')} a ${r.to.split('-').reverse().join('/')})`,
      `Visitantes únicos: ${number(r.totals.visitors)} · Páginas vistas: ${number(r.totals.views)}`,
      `Estudantes ativos: ${number(r.users.active)} · Contas novas: ${number(r.users.created)}`,
      `Conteúdo mais visto: ${top(t[1].rows)}`,
      `Estados: ${top(t[5].rows)}`,
      `Cidades: ${top(t[6].rows)}`,
      `Dispositivos: ${t[9].rows.map((d) => `${d.label} ${d.extra}`).join(', ')}`,
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2500);
  }

  protected number = number;
}
