/**
 * Quiet, synthesized battle sounds (Web Audio, no asset files). Reads only battle-log
 * events, like the renderers. Every voice is a few oscillators or a noise burst through a
 * filter, a few tens of milliseconds long, mixed low. The audio context starts on the
 * first user gesture (browsers require one); sound can be muted and the volume tuned.
 */
import { content } from "../content/index.js";
import type { BattleEvent, UnitSnapshot } from "../sim/index.js";

export type AttackStyle = "slash" | "thrust" | "smash" | "shoot" | "cast" | "pounce" | "support" | "shout";

/** How an ability looks and sounds, from the ability and the attacker's weapon. */
export function attackStyle(abilityId: string, weaponId: string, ranged: boolean): AttackStyle {
  switch (abilityId) {
    case "shield_bash":
    case "crushing_blow":
    case "piston_slam":
      return "smash";
    case "pounce":
    case "dive":
      return "pounce";
    case "war_cry":
      return "shout";
    case "piercing_shot":
      return "shoot";
  }
  const def = content.abilities[abilityId];
  if (def) {
    if (def.tags.includes("heal") || (def.target !== "enemy" && !def.effects.some((e) => e.kind === "damage"))) return "support";
    if (!def.tags.includes("melee")) return "cast";
  }
  const type = content.weapons[weaponId]?.type ?? "";
  if (ranged || type === "bow" || type === "crossbow" || type === "javelin") return ranged ? "shoot" : "thrust";
  if (type === "sword") return "slash";
  if (type === "dagger" || type === "spear") return "thrust";
  if (type === "fang" || type === "talons") return "pounce";
  return "smash";
}

/** The damage flavour of an ability, for spell sounds and effect colours. */
export function abilityElement(abilityId: string): string {
  const def = content.abilities[abilityId];
  const dmg = def?.effects.find((x) => x.kind === "damage");
  if (!dmg || dmg.kind !== "damage") return "none";
  const c = dmg.packet[0];
  return c?.element ?? c?.type ?? "none";
}

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  enabled = true;
  /** 0-100. */
  volume = 50;

  /** Call from a user gesture (a click) so the browser lets audio start. */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        // Deterministic white noise (no Math.random needed, and it sounds the same).
        let s = 12345;
        for (let i = 0; i < len; i++) {
          s = (Math.imul(s, 1103515245) + 12345) >>> 0;
          data[i] = (s / 4294967296) * 2 - 1;
        }
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private ready(key: string, gapMs: number): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== "running") return null;
    // Rate limit each voice so fast playback doesn't turn into a buzz.
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < gapMs) return null;
    this.last.set(key, now);
    this.master.gain.value = 0.35 * (this.volume / 100);
    return this.ctx;
  }

  /** A tone: oscillator with a pitch glide and a fast attack / exponential decay. */
  private tone(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise: whooshes, thuds, crackles. */
  private hiss(ctx: AudioContext, filter: BiquadFilterType, f0: number, f1: number, q: number, dur: number, gain: number, delay = 0): void {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(this.master!);
    src.start(t, (t * 7.3) % 0.3);
    src.stop(t + dur + 0.02);
  }

  attack(style: AttackStyle, element: string, speed: number): void {
    const ctx = this.ready(`atk-${style}`, 45);
    if (!ctx) return;
    const s = Math.max(1, Math.sqrt(speed));
    switch (style) {
      case "slash":
        this.hiss(ctx, "bandpass", 900, 3200, 1.2, 0.16 / s, 0.35);
        break;
      case "thrust":
        this.hiss(ctx, "bandpass", 1600, 2600, 2, 0.1 / s, 0.3);
        break;
      case "smash":
        this.hiss(ctx, "bandpass", 500, 1400, 1, 0.2 / s, 0.32);
        break;
      case "pounce":
        this.hiss(ctx, "lowpass", 700, 300, 1, 0.14 / s, 0.35);
        this.tone(ctx, "sawtooth", 140, 90, 0.12 / s, 0.04);
        break;
      case "shoot":
        this.tone(ctx, "triangle", 420, 190, 0.12, 0.18);
        this.hiss(ctx, "highpass", 2500, 4000, 0.7, 0.07, 0.12);
        break;
      case "cast":
        this.castSound(ctx, element);
        break;
      case "support":
        for (const [i, f] of [660, 880, 1320].entries()) this.tone(ctx, "sine", f, f, 0.35, 0.07, i * 0.06);
        break;
      case "shout":
        this.tone(ctx, "sawtooth", 220, 260, 0.3, 0.05);
        this.tone(ctx, "sawtooth", 330, 390, 0.3, 0.035);
        break;
    }
  }

  private castSound(ctx: AudioContext, element: string): void {
    switch (element) {
      case "fire":
        this.hiss(ctx, "lowpass", 1800, 500, 0.8, 0.35, 0.3);
        this.tone(ctx, "sine", 300, 520, 0.2, 0.05);
        break;
      case "lightning":
        this.hiss(ctx, "highpass", 3000, 6000, 0.5, 0.12, 0.25);
        this.tone(ctx, "square", 1200, 300, 0.1, 0.03);
        break;
      case "water":
        this.tone(ctx, "sine", 500, 220, 0.25, 0.12);
        this.hiss(ctx, "bandpass", 700, 400, 3, 0.25, 0.15);
        break;
      case "wind":
        this.hiss(ctx, "bandpass", 400, 1800, 2.5, 0.4, 0.25);
        break;
      default:
        // Psychic, spirit and the rest: a soft rising shimmer.
        this.tone(ctx, "sine", 520, 1040, 0.3, 0.07);
        this.tone(ctx, "sine", 780, 1560, 0.3, 0.04, 0.03);
    }
  }

  hit(outcome: string, damage: number, crit: boolean): void {
    if (outcome === "missed" || outcome === "dodged") {
      const ctx = this.ready("miss", 50);
      if (ctx) this.hiss(ctx, "bandpass", 2400, 1200, 1.5, 0.12, 0.12);
      return;
    }
    if (outcome === "parried" || outcome === "blocked" || outcome === "glanced off") {
      const ctx = this.ready("clink", 50);
      if (!ctx) return;
      this.tone(ctx, "square", 1850, 1700, 0.09, 0.05);
      this.tone(ctx, "sine", 2950, 2800, 0.14, 0.05);
      return;
    }
    const ctx = this.ready("hit", 40);
    if (!ctx) return;
    const g = crit ? 0.45 : Math.min(0.32, 0.16 + damage * 0.006);
    this.tone(ctx, "sine", crit ? 190 : 150, 55, crit ? 0.2 : 0.13, g);
    this.hiss(ctx, "lowpass", 1400, 300, 0.7, 0.07, g * 0.8);
    if (crit) this.tone(ctx, "triangle", 900, 1300, 0.12, 0.06, 0.02);
  }

  heal(): void {
    const ctx = this.ready("heal", 80);
    if (!ctx) return;
    this.tone(ctx, "sine", 880, 880, 0.3, 0.05);
    this.tone(ctx, "sine", 1320, 1320, 0.35, 0.04, 0.05);
  }

  step(): void {
    const ctx = this.ready("step", 70);
    if (ctx) this.hiss(ctx, "lowpass", 380, 200, 0.7, 0.05, 0.05);
  }

  knockout(): void {
    const ctx = this.ready("ko", 120);
    if (!ctx) return;
    this.tone(ctx, "sine", 120, 40, 0.4, 0.3);
    this.hiss(ctx, "lowpass", 600, 150, 0.7, 0.3, 0.18);
  }

  status(on: boolean): void {
    if (!on) return;
    const ctx = this.ready("status", 120);
    if (ctx) this.tone(ctx, "triangle", 700, 500, 0.12, 0.04);
  }

  end(won: boolean): void {
    const ctx = this.ready("end", 500);
    if (!ctx) return;
    const notes = won ? [523, 659, 784, 1047] : [440, 392, 330, 262];
    notes.forEach((f, i) => this.tone(ctx, "triangle", f, f, 0.32, 0.09, i * 0.13));
  }

  /** React to a battle-log event. `units` gives attacker weapons and positions. */
  onEvent(e: BattleEvent, speed: number, units: Map<number, UnitSnapshot & { x: number; y: number }>): void {
    switch (e.kind) {
      case "ability": {
        const a = units.get(e.uid);
        const t = units.get(e.target);
        const ranged = !!a && !!t && Math.abs(a.x - t.x) + Math.abs(a.y - t.y) > 1.5;
        this.attack(attackStyle(e.ability, a?.weaponId ?? "", ranged), abilityElement(e.ability), speed);
        break;
      }
      case "hit":
        this.hit(e.outcome, e.damage, e.crit);
        break;
      case "heal":
        this.heal();
        break;
      case "move":
        this.step();
        break;
      case "knockout":
        this.knockout();
        break;
      case "status":
        this.status(e.on);
        break;
      default:
        break;
    }
  }
}

export const sound = new Sound();
