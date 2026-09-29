import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal } from '@angular/core';

export interface ChartSeries {
  label: string;
  /** A CSS colour, usually a token such as var(--series-correct). */
  color: string;
  values: number[];
}

const HEIGHT = 380;
const PAD = { top: 16, right: 12, bottom: 34, left: 40 };

/**
 * Smooth line + area chart for a handful of series over the same x labels
 * ("Evolução Diária"). Drawn in pixels from the measured width so strokes and
 * markers keep their size; hover shows a crosshair with every series' value,
 * and a hidden table carries the same numbers for screen readers.
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.scss',
})
export class LineChart {
  readonly labels = input.required<string[]>();
  /** Longer labels for the tooltip and table; defaults to `labels`. */
  readonly fullLabels = input<string[]>();
  readonly series = input.required<ChartSeries[]>();
  /** Summary for assistive technology. */
  readonly description = input('');

  protected readonly height = HEIGHT;
  protected readonly pad = PAD;
  protected readonly width = signal(0);
  protected readonly hover = signal<number | null>(null);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const observer = new ResizeObserver(([entry]) => this.width.set(Math.floor(entry.contentRect.width)));
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  /** Round axis maximum and 5–8 gridlines. */
  protected readonly scale = computed(() => {
    const max = Math.max(4, ...this.series().flatMap((s) => s.values));
    const rawStep = max / 6;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? rawStep;
    const top = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    return { top, ticks };
  });

  protected x(index: number): number {
    const count = this.labels().length;
    const inner = this.width() - PAD.left - PAD.right;
    return PAD.left + (count <= 1 ? inner / 2 : (index / (count - 1)) * inner);
  }

  protected y(value: number): number {
    return PAD.top + (1 - value / this.scale().top) * (HEIGHT - PAD.top - PAD.bottom);
  }

  protected readonly paths = computed(() => {
    if (this.width() <= 0) return [];
    const baseline = this.y(0);
    return this.series().map((series) => {
      const points = series.values.map((v, i) => [this.x(i), this.y(v)] as const);
      const line = monotonePath(points);
      const area = points.length
        ? `${line} L${points.at(-1)![0]},${baseline} L${points[0][0]},${baseline} Z`
        : '';
      return { ...series, points, line, area };
    });
  });

  /** Thin the x labels out so they don't collide (about one per 64 px). */
  protected readonly labelEvery = computed(() => {
    const count = this.labels().length;
    const fit = Math.max(2, Math.floor((this.width() - PAD.left - PAD.right) / 64));
    return Math.max(1, Math.ceil(count / fit));
  });

  protected showLabel(index: number): boolean {
    const last = this.labels().length - 1;
    const every = this.labelEvery();
    // Always label the last day; skip a regular label that would crowd it.
    return index === last || (index % every === 0 && last - index >= every / 2);
  }

  protected onPointer(event: PointerEvent) {
    const svg = event.currentTarget as SVGElement;
    const left = event.clientX - svg.getBoundingClientRect().left;
    const count = this.labels().length;
    const inner = this.width() - PAD.left - PAD.right;
    const index = Math.round(((left - PAD.left) / inner) * (count - 1));
    this.hover.set(Math.min(Math.max(index, 0), count - 1));
  }

  protected tooltipLeft(index: number): number {
    // Keep the tooltip inside the chart.
    return Math.min(Math.max(this.x(index), 80), this.width() - 80);
  }

  protected fullLabel(index: number): string {
    return this.fullLabels()?.[index] ?? this.labels()[index];
  }
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson): smooth like the mock, but
 * never overshoots between points, so a curve can't dip below zero.
 */
function monotonePath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;

  const dx = points.slice(1).map((p, i) => p[0] - points[i][0]);
  const slopes = points.slice(1).map((p, i) => (p[1] - points[i][1]) / dx[i]);
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    const a = slopes[i - 1];
    const b = slopes[i];
    return a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + h * tangents[i]} ${x1 - h},${y1 - h * tangents[i + 1]} ${x1},${y1}`;
  }
  return d;
}
