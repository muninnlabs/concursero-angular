import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/api.service';
import { ConcursoFilterState } from '../../core/concurso-filter';
import type { ConcursoInfo, ConcursoLevel } from '../../core/models';
import { Icon } from '../../shared/icon';

interface FilterConfig {
  title: string;
  levels: { id: ConcursoLevel | undefined; label: string }[];
  /** Levels that ask for a state. */
  stateLevels: ConcursoLevel[];
  /** Concursos: município (municipal level). Vestibulares: university (every level). */
  second: 'municipio' | 'institution';
  editionLabel: string;
  allEditions: string;
}

const CONFIGS: Record<string, FilterConfig> = {
  CONCURSOS: {
    title: 'Filtrar concursos',
    levels: [
      { id: undefined, label: 'Todos' },
      { id: 'federal', label: 'Federal' },
      { id: 'estadual', label: 'Estadual' },
      { id: 'municipal', label: 'Municipal' },
    ],
    stateLevels: ['estadual', 'municipal'],
    second: 'municipio',
    editionLabel: 'Concurso',
    allEditions: 'Todos os concursos',
  },
  VESTIBULARES: {
    title: 'Filtrar vestibulares',
    levels: [
      { id: undefined, label: 'Todas' },
      { id: 'federal', label: 'Federal' },
      { id: 'estadual', label: 'Estadual' },
      { id: 'privada', label: 'Privada' },
    ],
    stateLevels: ['federal', 'estadual', 'privada'],
    second: 'institution',
    editionLabel: 'Vestibular',
    allEditions: 'Todos os vestibulares',
  },
};

const STATES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
  SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

const sortPt = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

/**
 * Narrows Concursos / Vestibulares practice: level, then state, then município (concursos) or university
 * (vestibulares), then the concurso / vestibular edition. Options only list what has questions, so no
 * combination ends up empty.
 */
@Component({
  selector: 'app-concurso-filter',
  imports: [Icon],
  templateUrl: './concurso-filter.html',
  styleUrl: './concurso-filter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConcursoFilterCard {
  readonly category = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly state = inject(ConcursoFilterState);

  protected readonly config = computed(() => CONFIGS[this.category()] ?? CONFIGS['CONCURSOS']);

  private readonly concursos = rxResource({
    params: () => this.category(),
    stream: ({ params }) => this.api.concursos(params),
  });
  protected readonly loading = this.concursos.isLoading;
  protected readonly failed = computed(() => !!this.concursos.error());

  private readonly all = computed<ConcursoInfo[]>(() => this.concursos.value() ?? []);
  protected readonly filter = computed(() => this.state.filter(this.category()));

  private readonly inLevel = computed(() => {
    const { level } = this.filter();
    return this.all().filter((c) => !level || c.level === level);
  });

  protected readonly states = computed(() =>
    [...new Set(this.inLevel().map((c) => c.uf).filter((uf): uf is string => !!uf))]
      .map((uf) => ({ uf, name: STATES[uf] ?? uf }))
      .sort((a, b) => sortPt(a.name, b.name)),
  );

  private readonly inState = computed(() => {
    const { uf } = this.filter();
    return this.inLevel().filter((c) => !uf || c.uf === uf);
  });

  protected readonly municipios = computed(() =>
    [...new Set(this.inState().map((c) => c.municipio).filter((m): m is string => !!m))].sort(sortPt),
  );

  protected readonly institutions = computed(() => [...new Set(this.inState().map((c) => c.institution))].sort(sortPt));

  /** Concursos / vestibulares matching the choices so far, newest first. */
  protected readonly options = computed(() => {
    const { municipio, institution } = this.filter();
    return this.inState()
      .filter((c) => (!municipio || c.municipio === municipio) && (!institution || c.institution === institution))
      .sort((a, b) => b.year - a.year || sortPt(a.name, b.name));
  });

  protected readonly questionCount = computed(() => {
    const { concurso } = this.filter();
    return this.options()
      .filter((c) => !concurso || c.id === concurso)
      .reduce((sum, c) => sum + c.questionCount, 0);
  });

  protected readonly showState = computed(() => {
    const level = this.filter().level;
    return !!level && this.config().stateLevels.includes(level);
  });
  protected readonly showMunicipio = computed(
    () => this.config().second === 'municipio' && this.filter().level === 'municipal' && !!this.filter().uf,
  );
  protected readonly showInstitution = computed(() => this.config().second === 'institution');
  protected readonly hasFilter = computed(() => Object.keys(this.filter()).length > 0);

  protected setLevel(level: ConcursoLevel | undefined) {
    this.state.setLevel(this.category(), level);
  }
  protected setUf(event: Event) {
    this.state.setUf(this.category(), this.value(event));
  }
  protected setMunicipio(event: Event) {
    this.state.setMunicipio(this.category(), this.value(event));
  }
  protected setInstitution(event: Event) {
    this.state.setInstitution(this.category(), this.value(event));
  }
  protected setConcurso(event: Event) {
    this.state.setConcurso(this.category(), this.value(event));
  }

  protected number(n: number): string {
    return n.toLocaleString('pt-BR');
  }

  private value(event: Event): string | undefined {
    return (event.target as HTMLSelectElement).value || undefined;
  }
}
