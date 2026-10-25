// Formatting and alternative identity, shared by every view so units and styles stay consistent.

/** Each alternative keeps one identity everywhere: number, color and line pattern. */
export interface AltStyle {
  color: string;
  dash: string | undefined; // Leaflet/SVG dash array; undefined = solid
  pattern: "solid" | "dashed" | "dotted";
}

export const ALT_STYLES: AltStyle[] = [
  { color: "#f2b632", dash: undefined, pattern: "solid" }, // gold
  { color: "#dcc6a0", dash: "10 7", pattern: "dashed" }, // tan
  { color: "#c9824a", dash: "2 6", pattern: "dotted" }, // caramel brown
];

export function altStyle(i: number): AltStyle {
  return ALT_STYLES[i % ALT_STYLES.length];
}

/** Money: always US dollars, billions with one decimal, millions with none. */
export function usd(x: number): string {
  if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  return `$${(x / 1e3).toFixed(0)}K`;
}

/** Durations are modeled in months and shown in years with one decimal. */
export function years(months: number): string {
  return `${(months / 12).toFixed(1)} yr`;
}

export function months(m: number): string {
  return `${Math.round(m)} mo`;
}

/** People: millions with two decimals, thousands with none. */
export function people(x: number): string {
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${Math.round(x / 1e3)}K`;
  return `${Math.round(x)}`;
}

export function miles(x: number): string {
  return `${Math.round(x).toLocaleString()} mi`;
}

export function pct(x: number, digits = 0): string {
  // never round a near-total up to an absolute claim
  if (x < 100 && Number(x.toFixed(digits)) >= 100) return `over ${(100 - 10 ** -digits).toFixed(digits)}%`;
  return `${x.toFixed(digits)}%`;
}

export function signed(x: number, fmt: (v: number) => string): string {
  if (Math.abs(x) < 1e-9) return "same";
  return `${x > 0 ? "+" : "−"}${fmt(Math.abs(x))}`;
}

export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
