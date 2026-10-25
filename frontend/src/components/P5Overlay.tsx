import { useEffect, useRef } from "react";
import type p5 from "p5";
import { useMap } from "react-leaflet";
import type { City, PlanResult } from "../api";
import { altStyle } from "../format";

interface Props {
  plan: PlanResult | null;
  cities: City[];
  selected: number;
  enabled: boolean;
  replayKey: number;
}

interface Pt {
  x: number;
  y: number;
}

interface Built {
  pts: Pt[];
  cum: number[]; // cumulative pixel distance along pts
  total: number; // pixels
  miles: number;
  ties: { at: number; x: number; y: number; nx: number; ny: number }[];
  markers: { at: number; mile: number; x: number; y: number; nx: number; ny: number }[];
  stations: { at: number; x: number; y: number }[];
}

const CASING = "#1f2937";
const TIE = "#4b5563";
const TIE_SPACING_PX = 7;
const MILES_PER_SECOND = 130;
const MIN_MS = 3500;
const MAX_MS = 8500;
const DONE_HOLD_MS = 2500;

function markerStep(miles: number): number {
  return [10, 25, 50, 100, 200].find((s) => miles / s <= 9) ?? 250;
}

/**
 * Construction animation on a p5.js canvas laid over the Leaflet map: the active corridor's
 * track is laid mile by mile at a constant pace, with ties, mile markers, a running mile count
 * at the work head, and stations marked as the build reaches them. The canvas never takes
 * pointer events; geometry is re-projected whenever the map moves and the canvas hides
 * during Leaflet's CSS zoom animation. With prefers-reduced-motion the finished track is drawn.
 */
export default function P5Overlay({ plan, cities, selected, enabled, replayKey }: Props) {
  const map = useMap();
  const state = useRef({ plan, cities, selected, built: null as Built | null });
  const restart = useRef<() => void>(() => {});

  useEffect(() => {
    state.current.plan = plan;
    state.current.cities = cities;
    state.current.selected = selected;
    restart.current();
  }, [plan, cities, selected, replayKey]);

  useEffect(() => {
    if (!enabled) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const container = map.getContainer();
    const host = document.createElement("div");
    host.className = "p5-overlay";
    container.appendChild(host);

    let instance: p5 | null = null;
    let cancelled = false;
    let start = performance.now();

    function project() {
      const s = state.current;
      const r = s.plan?.routes[s.selected];
      if (!r) {
        s.built = null;
        return;
      }
      const pts = r.geometry.coordinates.map(([lon, lat]) => map.latLngToContainerPoint([lat, lon]));
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
      const total = cum[cum.length - 1] || 1;
      const at = (d: number) => {
        let k = 1;
        while (k < cum.length - 1 && cum[k] < d) k++;
        const seg = cum[k] - cum[k - 1] || 1;
        const t = (d - cum[k - 1]) / seg;
        const a = pts[k - 1];
        const b = pts[k];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len };
      };
      const ties = [];
      for (let d = 0; d <= total; d += TIE_SPACING_PX) ties.push({ at: d, ...at(d) });
      const miles = r.stats.length_miles;
      const step = markerStep(miles);
      const markers = [];
      for (let m = step; m < miles - step * 0.4; m += step) {
        const d = (m / miles) * total;
        markers.push({ at: d, mile: m, ...at(d) });
      }
      const served = new Set(r.stats.stations);
      const stations = s.cities
        .filter((c) => served.has(c.name))
        .map((c) => {
          const p = map.latLngToContainerPoint([c.lat, c.lon]);
          let best = 0;
          let bestD = Infinity;
          pts.forEach((q, k) => {
            const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
            if (d < bestD) [best, bestD] = [k, d];
          });
          return { at: cum[best], x: p.x, y: p.y };
        });
      s.built = { pts: pts.map((q) => ({ x: q.x, y: q.y })), cum, total, miles, ties, markers, stations };
    }

    restart.current = () => {
      project();
      start = performance.now();
      instance?.loop();
    };

    const onMove = () => {
      project();
      instance?.redraw();
    };
    const onZoomStart = () => (host.style.visibility = "hidden");
    const onZoomEnd = () => {
      project();
      host.style.visibility = "visible";
      instance?.redraw();
    };
    const onResize = () => {
      const size = map.getSize();
      instance?.resizeCanvas(size.x, size.y);
      project();
    };
    map.on("move", onMove);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    map.on("resize", onResize);

    // p5 is ~1 MB, so load it only when the overlay is turned on.
    import("p5").then(({ default: P5 }) => {
      if (cancelled) return;
      instance = new P5((p: p5) => {
        function pathTo(b: Built, length: number) {
          p.beginShape();
          for (let k = 0; k < b.pts.length; k++) {
            if (b.cum[k] <= length) {
              p.vertex(b.pts[k].x, b.pts[k].y);
              continue;
            }
            const seg = b.cum[k] - b.cum[k - 1] || 1;
            const t = (length - b.cum[k - 1]) / seg;
            p.vertex(b.pts[k - 1].x + (b.pts[k].x - b.pts[k - 1].x) * t, b.pts[k - 1].y + (b.pts[k].y - b.pts[k - 1].y) * t);
            break;
          }
          p.endShape();
        }

        function label(text: string, x: number, y: number, bg: string, fg: string) {
          p.textSize(12);
          p.textStyle(p.BOLD);
          const w = p.textWidth(text) + 14;
          p.noStroke();
          p.fill(bg);
          p.rect(x, y, w, 22, 1);
          p.fill(fg);
          p.textAlign(p.LEFT, p.CENTER);
          p.text(text, x + 7, y + 11);
        }

        p.setup = () => {
          const size = map.getSize();
          p.createCanvas(size.x, size.y).parent(host);
          p.frameRate(60);
          p.textFont("Jost");
          project();
        };

        p.draw = () => {
          p.clear();
          const b = state.current.built;
          if (!b) return;
          const COLOR = altStyle(state.current.selected).color;
          const duration = Math.min(MAX_MS, Math.max(MIN_MS, (b.miles / MILES_PER_SECOND) * 1000));
          const elapsed = performance.now() - start;
          const frac = reduced ? 1 : Math.min(1, elapsed / duration);
          const length = frac * b.total;
          const mile = Math.round(frac * b.miles);

          // ties under the rail
          p.stroke(TIE);
          p.strokeWeight(2);
          for (const t of b.ties) {
            if (t.at > length) break;
            p.line(t.x - t.nx * 7, t.y - t.ny * 7, t.x + t.nx * 7, t.y + t.ny * 7);
          }
          // rail: dark casing, yellow core
          p.noFill();
          p.strokeJoin(p.ROUND);
          p.stroke(CASING);
          p.strokeWeight(7);
          pathTo(b, length);
          p.stroke(COLOR);
          p.strokeWeight(4);
          pathTo(b, length);

          // stations reached so far
          for (const st of b.stations) {
            if (st.at > length + 1) continue;
            p.stroke(CASING);
            p.strokeWeight(2);
            p.fill(COLOR);
            p.circle(st.x, st.y, 14);
          }

          // mile markers passed so far
          p.textSize(11);
          for (const m of b.markers) {
            if (m.at > length) break;
            p.stroke(CASING);
            p.strokeWeight(1.5);
            p.fill("#ffffff");
            p.circle(m.x, m.y, 8);
            const tx = m.x + m.nx * 16;
            const ty = m.y + m.ny * 16;
            p.textAlign(p.CENTER, p.CENTER);
            p.textStyle(p.BOLD);
            p.stroke(CASING);
            p.strokeWeight(3);
            p.fill("#fff");
            p.text(`${m.mile}`, tx, ty);
          }

          if (frac < 1) {
            // work head with running mile count
            const k = b.cum.findIndex((c) => c >= length);
            const seg = Math.max(1, k);
            const t = (length - b.cum[seg - 1]) / (b.cum[seg] - b.cum[seg - 1] || 1);
            const hx = b.pts[seg - 1].x + (b.pts[seg].x - b.pts[seg - 1].x) * t;
            const hy = b.pts[seg - 1].y + (b.pts[seg].y - b.pts[seg - 1].y) * t;
            p.stroke(CASING);
            p.strokeWeight(2);
            p.fill(COLOR);
            p.circle(hx, hy, 14);
            label(`Mile ${mile} of ${Math.round(b.miles)}`, hx + 12, hy - 30, CASING, "#ffffff");
          } else {
            const end = b.pts[b.pts.length - 1];
            const sinceDone = elapsed - duration;
            if (reduced || sinceDone < DONE_HOLD_MS) {
              label(`${Math.round(b.miles)} miles of track`, end.x + 12, end.y - 30, CASING, "#ffffff");
            }
            // finished: stop drawing until the map moves or the build restarts
            if (reduced || sinceDone >= DONE_HOLD_MS) p.noLoop();
          }
        };
      });
    });

    return () => {
      cancelled = true;
      map.off("move", onMove);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      map.off("resize", onResize);
      restart.current = () => {};
      instance?.remove();
      host.remove();
    };
  }, [enabled, map]);

  return null;
}
