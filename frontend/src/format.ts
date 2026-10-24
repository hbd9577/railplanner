import type { CSSProperties } from "react";

// Gold / tan / brown palette (after the SBUHacks "Steel and Steam" site). Only the active corridor
// carries color; the others are greyed out, so identity comes from the route number and name.
export const PALETTE = {
  yellow: "#f2b632", // gold: active corridor on the satellite map
  gold: "#e8a91c", // active corridor in charts and tables on the dark page
  tan: "#e6cf98",
  brown: "#7b4a1e",
  grey: "#6f6150", // inactive corridors in charts and tables
  mapGrey: "#efe6d2", // inactive corridors on the satellite map
};

/** Fill for bars and marks: gold when active, muted brown-grey otherwise. */
export function routeColor(i: number, selected: number): string {
  return i === selected ? PALETTE.gold : PALETTE.grey;
}

/** Number badge colors: gold with dark text when active, dark brown with cream text otherwise. */
export function badgeStyle(i: number, selected: number): CSSProperties {
  return i === selected ? { background: PALETTE.gold, color: "#221910" } : { background: "#3d3124", color: "#f3e7c9" };
}

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
