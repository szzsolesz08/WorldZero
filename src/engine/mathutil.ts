/** sqrt(dx*dx + dy*dy) — much faster than Math.hypot in V8 hot loops. */
export function dist2d(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}
