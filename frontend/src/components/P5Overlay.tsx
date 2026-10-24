import { useEffect, useRef } from "react";
import type p5 from "p5";
import { useMap } from "react-leaflet";
import type { City, PlanResult } from "../api";
import { ROUTE_COLORS } from "../format";

interface Props {
  plan: PlanResult | null;
  cities: City[];
  selected: number;
  enabled: boolean;
}

interface Projected {
  pts: { x: number; y: number }[];
  cum: number[]; // cumulative pixel distance along pts
  miles: number;
  color: string;
}

// All trains run at the same real-world speed, so the shortest alternative arrives first.
const LONGEST_RUN_MS = 6500;
const DWELL_MS = 1400;
const TRAIL_MILES_FRAC = 0.035;

/**
 * A p5.js canvas laid over the Leaflet map (between the route lines and the markers).
 * It never takes pointer events, so Leaflet keeps handling clicks, hover and tooltips.
 * Geometry is re-projected to screen pixels whenever the map moves; the canvas hides
 * during Leaflet's CSS zoom animation and redraws when it settles.
 */
export default function P5Overlay({ plan, cities, selected, enabled }: Props) {
  const map = useMap();
  const state = useRef({ plan, cities, selected, routes: [] as Projected[], stations: [] as { x: number; y: number; r: number }[] });
  const reproject = useRef<() => void>(() => {});

  // Keep the sketch's view of props current without recreating it.
  useEffect(() => {
    state.current.plan = plan;
    state.current.cities = cities;
    state.current.selected = selected;
    reproject.current();
  }, [plan, cities, selected]);

  useEffect(() => {
    if (!enabled) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const container = map.getContainer();
    const host = document.createElement("div");
    host.className = "p5-overlay";
    container.appendChild(host);

    let instance: p5 | null = null;
    let cancelled = false;
    let cycleStart = performance.now();

    function project() {
      const s = state.current;
      if (!s.plan) {
        s.routes = [];
        s.stations = [];
        return;
      }
      s.routes = s.plan.routes.map((r, i) => {
        const pts = r.geometry.coordinates.map(([lon, lat]) => map.latLngToContainerPoint([lat, lon]));
        const cum = [0];
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
        return { pts: pts.map((p) => ({ x: p.x, y: p.y })), cum, miles: r.stats.length_miles, color: ROUTE_COLORS[i] };
      });
      const served = new Set(s.plan.routes[s.selected]?.stats.stations ?? []);
      s.stations = s.cities
        .filter((c) => served.has(c.name))
        .map((c) => {
          const p = map.latLngToContainerPoint([c.lat, c.lon]);
          return { x: p.x, y: p.y, r: 6 + Math.sqrt((c.population ?? 50_000) / 1e6) * 9 };
        });
    }
    reproject.current = () => {
      project();
      cycleStart = performance.now(); // restart the race when the plan or selection changes
    };

    function pointAt(r: Projected, frac: number) {
      const target = Math.max(0, Math.min(1, frac)) * r.cum[r.cum.length - 1];
      let k = 1;
      while (k < r.cum.length - 1 && r.cum[k] < target) k++;
      const seg = r.cum[k] - r.cum[k - 1] || 1;
      const t = (target - r.cum[k - 1]) / seg;
      const a = r.pts[k - 1];
      const b = r.pts[k];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    const onMove = () => {
      project();
      if (reduced) instance?.redraw(); // static frame: redraw on pan instead of every frame
    };
    const onZoomStart = () => (host.style.visibility = "hidden");
    const onZoomEnd = () => {
      project();
      host.style.visibility = "visible";
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
        p.setup = () => {
          const size = map.getSize();
          p.createCanvas(size.x, size.y).parent(host);
          p.frameRate(60);
          project();
          if (reduced) p.noLoop();
        };

        p.draw = () => {
          p.clear();
          const s = state.current;
          if (!s.routes.length) return;
          const now = performance.now();

          // Stations on the selected route: static rings sized by population (no pulsing).
          s.stations.forEach((st) => {
            const c = p.color(ROUTE_COLORS[s.selected] ?? "#161b21");
            c.setAlpha(110);
            p.noFill();
            p.stroke(c);
            p.strokeWeight(1.5);
            p.circle(st.x, st.y, 2 * st.r);
          });

          // Trains: constant real-world speed, the longest route takes LONGEST_RUN_MS.
          const longest = Math.max(...s.routes.map((r) => r.miles));
          const elapsed = reduced ? LONGEST_RUN_MS * 0.6 : (now - cycleStart) % (LONGEST_RUN_MS + DWELL_MS);
          const milesRun = (elapsed / LONGEST_RUN_MS) * longest;

          s.routes.forEach((r, i) => {
            const frac = Math.min(1, milesRun / r.miles);
            const sel = i === s.selected;
            const trailFrac = (TRAIL_MILES_FRAC * longest) / r.miles;

            // fading trail behind the train
            const steps = 14;
            for (let k = 0; k < steps; k++) {
              const f0 = frac - (trailFrac * (k + 1)) / steps;
              const f1 = frac - (trailFrac * k) / steps;
              if (f1 <= 0) break;
              const a = pointAt(r, f0);
              const b = pointAt(r, f1);
              const c = p.color(r.color);
              c.setAlpha(220 * (1 - k / steps));
              p.stroke(c);
              p.strokeWeight((sel ? 6 : 4) * (1 - k / (steps * 1.4)));
              p.line(a.x, a.y, b.x, b.y);
            }

            const head = pointAt(r, frac);
            p.stroke(255);
            p.strokeWeight(2);
            p.fill(r.color);
            p.circle(head.x, head.y, sel ? 13 : 10);

            // arrival marker: ring holds at the destination during the dwell
            if (frac >= 1) {
              const c = p.color(r.color);
              c.setAlpha(160);
              p.noFill();
              p.stroke(c);
              p.strokeWeight(2);
              p.circle(head.x, head.y, 22 + i * 7);
            }
          });
        };
      });
    });

    return () => {
      cancelled = true;
      map.off("move", onMove);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      map.off("resize", onResize);
      reproject.current = () => {};
      instance?.remove();
      host.remove();
    };
  }, [enabled, map]);

  return null;
}
