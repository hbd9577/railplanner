import type { CSSProperties } from "react";

// Yellow / tan / brown palette. Only the active corridor carries color; the others are greyed
// out, so identity comes from the route number and name, never from hue.
export const PALETTE = {
  yellow: "#f2c12e", // active corridor on the satellite map
  tan: "#d9c4a0",
  brown: "#7a4e2d", // active corridor in charts and tables (7:1 with white text)
  grey: "#b5aea3", // inactive corridors in charts and tables
  mapGrey: "#e6e2da", // inactive corridors on the satellite map
};

/** Fill for bars and marks: brown when active, grey otherwise. */
export function routeColor(i: number, selected: number): string {
  return i === selected ? PALETTE.brown : PALETTE.grey;
}

/** Number badge colors: brown with white text when active, light grey with dark text otherwise. */
export function badgeStyle(i: number, selected: number): CSSProperties {
  return i === selected ? { background: PALETTE.brown, color: "#fff" } : { background: "#e2dcd2", color: "#2b2118" };
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
