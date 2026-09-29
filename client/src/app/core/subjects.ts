import type { IconName } from '../shared/icon';

export type SubjectTone = 'orange' | 'blue' | 'purple' | 'green' | 'rose' | 'amber';

export interface SubjectStyle {
  icon: IconName;
  tone: SubjectTone;
  description: string;
}

// Subject names exactly as they appear in the exam JSON files.
const STYLES: Record<string, SubjectStyle> = {
  // ENEM areas
  'Linguagens, Códigos e Suas Tecnologias': {
    icon: 'pen-tool',
    tone: 'green',
    description: 'Português, literatura, interpretação de texto, artes e língua estrangeira.',
  },
  'Ciências Humanas e Suas Tecnologias': {
    icon: 'landmark',
    tone: 'orange',
    description: 'História, geografia, filosofia e sociologia.',
  },
  'Ciências da Natureza e Suas Tecnologias': {
    icon: 'flask',
    tone: 'blue',
    description: 'Biologia, química e física aplicadas ao cotidiano.',
  },
  'Matemática e Suas Tecnologias': {
    icon: 'calculator',
    tone: 'purple',
    description: 'Álgebra, geometria, estatística e raciocínio lógico.',
  },

  // OAB
  'Direito Ético-Profissional (Estatuto da OAB)': {
    icon: 'shield-check',
    tone: 'purple',
    description: 'Estatuto da Advocacia, Código de Ética e Regulamento Geral da OAB.',
  },
  'Direito do Trabalho': { icon: 'briefcase', tone: 'orange', description: 'CLT, contrato de trabalho, jornada, salário e rescisão.' },
  'Direito Civil': { icon: 'scale', tone: 'blue', description: 'Parte geral, obrigações, contratos, família e sucessões.' },
  'Direito Processual Civil': { icon: 'scale', tone: 'green', description: 'CPC/15, procedimentos, recursos e execução.' },
  'Direito Penal': { icon: 'gavel', tone: 'rose', description: 'Teoria do crime, penas e crimes em espécie.' },
  'Direito Constitucional': {
    icon: 'scale',
    tone: 'purple',
    description: 'Organização do estado, direitos fundamentais e CF/88.',
  },
  'Direito Administrativo': { icon: 'building', tone: 'blue', description: 'Atos, licitações, contratos e servidores públicos.' },
  'Direito Empresarial': { icon: 'coins', tone: 'amber', description: 'Sociedades, títulos de crédito, falência e recuperação.' },
  'Direito Processual Penal': { icon: 'gavel', tone: 'orange', description: 'Inquérito, ação penal, provas, prisões e recursos.' },
  'Direito Tributário': { icon: 'coins', tone: 'green', description: 'Tributos, competência, obrigação e crédito tributário.' },
  'Direito Processual do Trabalho': { icon: 'briefcase', tone: 'blue', description: 'Reclamação trabalhista, audiências e recursos.' },
  'Direitos Humanos': { icon: 'heart-handshake', tone: 'rose', description: 'Tratados internacionais e sistemas de proteção.' },
  'Direito da Criança e do Adolescente (ECA)': { icon: 'baby', tone: 'amber', description: 'Proteção integral, medidas e ato infracional.' },
  'Estatuto da Criança e do Adolescente (ECA)': { icon: 'baby', tone: 'amber', description: 'Proteção integral, medidas e ato infracional.' },
  'Direito Ambiental': { icon: 'leaf', tone: 'green', description: 'Política ambiental, licenciamento e responsabilidade.' },
  'Direito do Consumidor': { icon: 'shopping-cart', tone: 'orange', description: 'CDC, relações de consumo e responsabilidade do fornecedor.' },
  'Filosofia do Direito': { icon: 'book-open', tone: 'purple', description: 'Correntes do pensamento jurídico e teoria da justiça.' },
  'Direito Eleitoral': { icon: 'vote', tone: 'blue', description: 'Partidos, elegibilidade e processo eleitoral.' },
  'Direito Previdenciário': { icon: 'users', tone: 'green', description: 'Seguridade social, benefícios e custeio.' },
  'Direito Financeiro': { icon: 'coins', tone: 'blue', description: 'Orçamento público e responsabilidade fiscal.' },
  'Direito Econômico': { icon: 'coins', tone: 'amber', description: 'Ordem econômica e defesa da concorrência.' },
};

const TONES: SubjectTone[] = ['orange', 'blue', 'purple', 'green'];

export function subjectStyle(subject: string, index = 0): SubjectStyle {
  const known = STYLES[subject];
  if (known) return known;
  if (subject.startsWith('Direito Internacional')) {
    return { icon: 'globe', tone: 'blue', description: 'Tratados, nacionalidade e conflito de leis no espaço.' };
  }
  return { icon: 'layers', tone: TONES[index % TONES.length], description: '' };
}
