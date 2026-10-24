// First three slots of the validated categorical palette (all-pairs CVD-safe; aqua needs direct labels).
export const ROUTE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];

export function usd(x: number): string {
  if (x >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  return `$${(x / 1e3).toFixed(0)}K`;
}

export function months(x: number): string {
  return `${Math.round(x)} mo`;
}

export function years(m: number): string {
  return `${(m / 12).toFixed(1)} yrs`;
}

export function people(x: number): string {
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${Math.round(x / 1e3)}K`;
  return `${x}`;
}

export function pct(x: number, digits = 0): string {
  return `${x.toFixed(digits)}%`;
}
