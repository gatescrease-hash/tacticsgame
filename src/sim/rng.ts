/**
 * Seeded, integer-only random number generator (mulberry32).
 *
 * The whole state is one uint32, so it can live inside BattleState and be
 * copied or snapshotted cheaply. Never use Math.random() in the simulation.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next raw uint32. */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return this.nextU32() % n;
  }

  /** True with `percent`% probability (integer percent, 0-100). */
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  get seedState(): number {
    return this.state;
  }
}
