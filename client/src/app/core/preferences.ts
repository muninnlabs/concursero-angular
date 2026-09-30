import { Injectable, effect, signal } from '@angular/core';

export interface Preferences {
  darkMode: boolean;
  sounds: boolean;
}

const STORAGE_KEY = 'brasilquiz.preferences';
const DEFAULTS: Preferences = { darkMode: false, sounds: true };

/**
 * "Preferências do App": kept per browser, like the chosen category. Dark mode
 * applies inside the signed-in app (the shell sets data-theme); the landing
 * and login pages keep their light design.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly value = signal<Preferences>(read());

  private audio: AudioContext | null = null;

  constructor() {
    effect(() => {
      const prefs = this.value();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // Storage unavailable: the choice lasts for this visit only.
      }
    });
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    this.value.update((prefs) => ({ ...prefs, [key]: value }));
  }

  /** Short chime for a right answer, low buzz for a wrong one ("Efeitos Sonoros"). */
  playResult(correct: boolean) {
    if (!this.value().sounds) return;
    try {
      this.audio ??= new AudioContext();
      const notes = correct ? [660, 880] : [220, 180];
      notes.forEach((frequency, i) => this.tone(frequency, i * 0.12, correct ? 'sine' : 'square'));
    } catch {
      // No Web Audio: stay silent.
    }
  }

  private tone(frequency: number, delay: number, type: OscillatorType) {
    const ctx = this.audio!;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(type === 'sine' ? 0.18 : 0.05, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  }
}

function read(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      darkMode: typeof stored.darkMode === 'boolean' ? stored.darkMode : DEFAULTS.darkMode,
      sounds: typeof stored.sounds === 'boolean' ? stored.sounds : DEFAULTS.sounds,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
