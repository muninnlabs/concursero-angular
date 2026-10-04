// Gamification rules for the student profile: XP, levels, badges and streaks.
// Everything is derived from answers and simulados, so changing a rule here
// applies retroactively to every user.

/** XP per answer and per finished simulado. */
export const XP = {
  correct: 10,
  wrong: 2,
  simulado: 20,
  /** Extra for a simulado of at least PERFECT_MIN_QUESTIONS answered without mistakes. */
  perfectSimulado: 50,
} as const;

export const PERFECT_MIN_QUESTIONS = 10;

/** SQL expressions for the XP above, shared by the profile and the ranking queries. */
export const ANSWER_XP_SQL = `CASE WHEN is_correct = 1 THEN ${XP.correct} ELSE ${XP.wrong} END`;
export const SIMULADO_XP_SQL = `${XP.simulado} + CASE WHEN correct = total AND total >= ${PERFECT_MIN_QUESTIONS} THEN ${XP.perfectSimulado} ELSE 0 END`;

export interface LevelInfo {
  level: number;
  /** XP where this level starts and where the next one starts. */
  levelXp: number;
  nextLevelXp: number;
}

/** Level n starts at 50·n·(n−1) XP: 0, 100, 300, 600, 1000, … (each level takes 100 XP more than the last). */
export function levelFor(xp: number): LevelInfo {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + Math.max(0, xp) / 12.5)) / 2));
  return { level, levelXp: 50 * level * (level - 1), nextLevelXp: 50 * (level + 1) * level };
}

/** Longest run of consecutive days; `days` are distinct YYYY-MM-DD strings in any order. */
export function longestStreak(days: string[]): number {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    const time = Date.parse(`${day}T00:00:00Z`);
    run = previous !== null && time - previous === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

export interface BadgeMetrics {
  answered: number;
  longestStreak: number;
  simulados: number;
  perfectSimulados: number;
  bySubject: { subject: string; answered: number; correct: number }[];
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  /** Icon name understood by the web client (shared/icon.ts). */
  icon: string;
  tone: 'amber' | 'green' | 'blue' | 'purple' | 'rose' | 'indigo';
  unlocked: boolean;
  progress: number;
  target: number;
  /** e.g. the subject an "Especialista" badge was earned in. */
  detail?: string;
}

export const EXPERT_MIN_ANSWERS = 50;
export const EXPERT_MIN_ACCURACY = 0.8;

export function badgesFor(m: BadgeMetrics): Badge[] {
  const badge = (b: Omit<Badge, 'unlocked' | 'progress'>, value: number): Badge => ({
    ...b,
    progress: Math.min(value, b.target),
    unlocked: value >= b.target,
  });

  // Best subject for "Especialista": accurate enough, closest to the answer count.
  const expert = m.bySubject
    .filter((s) => s.answered > 0 && s.correct / s.answered >= EXPERT_MIN_ACCURACY)
    .sort((a, b) => b.answered - a.answered)[0];

  return [
    badge({ id: 'primeiro-passo', name: 'Primeiro Passo', description: '100 questões', icon: 'graduation-cap', tone: 'green', target: 100 }, m.answered),
    badge({ id: 'dedicado', name: 'Dedicado', description: '500 questões', icon: 'book-open', tone: 'blue', target: 500 }, m.answered),
    badge({ id: 'lendario', name: 'Lendário', description: '1.000 questões', icon: 'trophy', tone: 'amber', target: 1000 }, m.answered),
    badge({ id: 'aquecendo', name: 'Aquecendo', description: '3 dias seguidos', icon: 'flame', tone: 'rose', target: 3 }, m.longestStreak),
    badge({ id: 'em-ritmo', name: 'Em Ritmo', description: '7 dias seguidos', icon: 'flame', tone: 'amber', target: 7 }, m.longestStreak),
    badge({ id: 'chama-acesa', name: 'Chama Acesa', description: '30 dias seguidos', icon: 'flame', tone: 'purple', target: 30 }, m.longestStreak),
    badge({ id: 'simulador', name: 'Simulador', description: '10 simulados', icon: 'timer', tone: 'indigo', target: 10 }, m.simulados),
    badge({ id: 'invencivel', name: 'Invencível', description: 'Simulado 100%', icon: 'shield', tone: 'blue', target: 1 }, m.perfectSimulados),
    {
      ...badge(
        { id: 'especialista', name: 'Especialista', description: '80% em uma matéria', icon: 'award', tone: 'purple', target: EXPERT_MIN_ANSWERS },
        expert?.answered ?? 0,
      ),
      detail: expert?.subject,
    },
  ];
}

/** "Ana Paula Souza" → "Ana S.": other students' full names never leave the server. */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Estudante';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts.at(-1)![0].toUpperCase()}.`;
}
