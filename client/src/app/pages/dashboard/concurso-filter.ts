import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/api.service';
import { ConcursoFilterState } from '../../core/concurso-filter';
import type { ConcursoInfo, ConcursoLevel } from '../../core/models';
import { Icon } from '../../shared/icon';

const LEVELS: { id: ConcursoLevel | undefined; label: string }[] = [
  { id: undefined, label: 'Todos' },
  { id: 'federal', label: 'Federal' },
  { id: 'estadual', label: 'Estadual' },
  { id: 'municipal', label: 'Municipal' },
];

const STATES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
  SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

/**
 * Narrows Concursos practice: level, then state (estadual/municipal), município (municipal) and concurso.
 * Options only list what has questions, so no combination ends up empty.
 */
@Component({
  selector: 'app-concurso-filter',
  imports: [Icon],
  templateUrl: './concurso-filter.html',
  styleUrl: './concurso-filter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConcursoFilterCard {
  private readonly api = inject(ApiService);
  protected readonly state = inject(ConcursoFilterState);
  protected readonly levels = LEVELS;

  private readonly concursos = rxResource({ stream: () => this.api.concursos() });
  protected readonly loading = this.concursos.isLoading;
  protected readonly failed = computed(() => !!this.concursos.error());

  private readonly all = computed<ConcursoInfo[]>(() => this.concursos.value() ?? []);
  protected readonly filter = this.state.filter;

  private readonly inLevel = computed(() => {
    const { level } = this.filter();
    return this.all().filter((c) => !level || c.level === level);
  });

  protected readonly states = computed(() =>
    [...new Set(this.inLevel().map((c) => c.uf).filter((uf): uf is string => !!uf))]
      .map((uf) => ({ uf, name: STATES[uf] ?? uf }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  );

  private readonly inState = computed(() => {
    const { uf } = this.filter();
    return this.inLevel().filter((c) => !uf || c.uf === uf);
  });

  protected readonly municipios = computed(() =>
    [...new Set(this.inState().map((c) => c.municipio).filter((m): m is string => !!m))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    ),
  );

  /** Concursos matching level/state/município, newest first. */
  protected readonly options = computed(() => {
    const { municipio } = this.filter();
    return this.inState()
      .filter((c) => !municipio || c.municipio === municipio)
      .sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, 'pt-BR'));
  });

  protected readonly questionCount = computed(() => {
    const { concurso } = this.filter();
    return this.options()
      .filter((c) => !concurso || c.id === concurso)
      .reduce((sum, c) => sum + c.questionCount, 0);
  });

  protected readonly showState = computed(() => this.filter().level === 'estadual' || this.filter().level === 'municipal');
  protected readonly showMunicipio = computed(() => this.filter().level === 'municipal' && !!this.filter().uf);
  protected readonly hasFilter = computed(() => Object.keys(this.filter()).length > 0);

  protected number(n: number): string {
    return n.toLocaleString('pt-BR');
  }

  protected value(event: Event): string | undefined {
    return (event.target as HTMLSelectElement).value || undefined;
  }
}
