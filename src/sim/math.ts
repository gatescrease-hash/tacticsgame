/** Integer helpers. Keep simulation maths in integers so results match across machines. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Integer division rounding toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}
