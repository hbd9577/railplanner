import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Distribution } from "../api";

interface Props {
  title: string;
  dist: Distribution;
  color: string;
  format: (v: number) => string;
  runs: number;
  threshold?: number; // optional user budget or date, drawn as a marker
  thresholdLabel?: string;
}

interface Datum {
  key: string;
  lo: number;
  hi: number;
  count: number;
}

const MARKERS = [
  { p: "P10", pos: "insideTopRight" },
  { p: "P50", pos: "top" },
  { p: "P90", pos: "insideTopLeft" },
] as const;

/** Share of simulated runs above `x`, interpolating linearly inside the histogram bin. */
export function shareAbove(dist: Distribution, x: number): number {
  const total = dist.histogram.reduce((a, b) => a + b.count, 0) || 1;
  let above = 0;
  for (const b of dist.histogram) {
    if (b.lo >= x) above += b.count;
    else if (b.hi > x) above += (b.count * (b.hi - x)) / (b.hi - b.lo);
  }
  return above / total;
}

// Histogram of Monte Carlo runs with P10/P50/P90 markers. Bins come from the TimescaleDB
// continuous aggregate (or the identical local fallback). A text summary follows for screen readers.
export default function DistributionChart({ title, dist, color, format, runs, threshold, thresholdLabel }: Props) {
  const data: Datum[] = dist.histogram.map((b, i) => ({ key: String(i), lo: b.lo, hi: b.hi, count: b.count }));
  const values = { P10: dist.p10, P50: dist.p50, P90: dist.p90 };
  const binOf = (v: number) => {
    const i = data.findIndex((d) => v >= d.lo && v < d.hi);
    return String(i === -1 ? (v < data[0].lo ? 0 : data.length - 1) : i);
  };

  return (
    <figure className="dist">
      <figcaption>
        <span className="dist-title">{title}</span>
        <span className="pline num-cell">
          P10 {format(values.P10)} · <strong>P50 {format(values.P50)}</strong> · P90 {format(values.P90)}
        </span>
      </figcaption>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 22, right: 12, bottom: 0, left: 12 }} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke="#e5e7eb" />
            <XAxis
              dataKey="key"
              tickFormatter={(k) => format(data[Number(k)]?.lo ?? 0)}
              interval={Math.max(0, Math.floor(data.length / 5) - 1)}
              tick={{ fontSize: 12, fill: "#4b5563" }}
              tickLine={false}
              axisLine={{ stroke: "#9ca3af" }}
            />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "rgba(17, 24, 39, 0.05)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as Datum;
                return (
                  <div className="chart-tip">
                    <div className="tip-head">
                      {format(d.lo)}–{format(d.hi)}
                    </div>
                    <div>
                      {d.count.toLocaleString()} of {runs.toLocaleString()} runs ({((100 * d.count) / runs).toFixed(1)}%)
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" fill={color} fillOpacity={0.8} isAnimationActive={false} />
            {MARKERS.map((m) => (
              <ReferenceLine
                key={m.p}
                x={binOf(values[m.p])}
                stroke="#111827"
                strokeDasharray={m.p === "P50" ? undefined : "4 3"}
                strokeWidth={m.p === "P50" ? 2 : 1.25}
                label={{ value: m.p, position: m.pos, fontSize: 12, fill: "#111827" }}
              />
            ))}
            {threshold !== undefined && (
              <ReferenceLine
                x={binOf(threshold)}
                stroke="#b91c1c"
                strokeWidth={2}
                label={{ value: thresholdLabel ?? "Limit", position: "insideBottomRight", fontSize: 12, fill: "#b91c1c" }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        {title}: in the middle 80% of {runs.toLocaleString()} modeled outcomes, between {format(values.P10)} and{" "}
        {format(values.P90)}, with a median of {format(values.P50)}.
      </p>
    </figure>
  );
}
