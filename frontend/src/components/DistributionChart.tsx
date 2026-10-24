import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Distribution } from "../api";

interface Props {
  title: string;
  dist: Distribution;
  color: string;
  format: (v: number) => string;
  runs: number;
}

interface Datum {
  key: string;
  lo: number;
  hi: number;
  count: number;
}

const MARKERS = [
  { p: "P10", label: "Optimistic", pos: "insideTopRight" },
  { p: "P50", label: "Median", pos: "top" },
  { p: "P90", label: "Conservative", pos: "insideTopLeft" },
] as const;

// Histogram of Monte Carlo runs with P10/P50/P90 markers. Bins come from the
// TimescaleDB continuous aggregate (or the identical local fallback).
export default function DistributionChart({ title, dist, color, format, runs }: Props) {
  const data: Datum[] = dist.histogram.map((b, i) => ({ key: String(i), lo: b.lo, hi: b.hi, count: b.count }));
  const values = { P10: dist.p10, P50: dist.p50, P90: dist.p90 };
  const binOf = (v: number) => {
    const i = data.findIndex((d) => v >= d.lo && v < d.hi);
    return String(i === -1 ? (v < data[0].lo ? 0 : data.length - 1) : i);
  };

  return (
    <figure className="dist">
      <figcaption>
        <div className="dist-title">{title}</div>
        <div className="pline">
          {MARKERS.map((m) => (
            <span key={m.p} className={m.p === "P50" ? "main" : ""} title={m.label}>
              <span className="plbl">{m.p}</span> {format(values[m.p])}
            </span>
          ))}
        </div>
      </figcaption>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ top: 22, right: 12, bottom: 0, left: 12 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="#ebe9e3" />
          <XAxis
            dataKey="key"
            tickFormatter={(k) => format(data[Number(k)]?.lo ?? 0)}
            interval={Math.max(0, Math.floor(data.length / 5) - 1)}
            tick={{ fontSize: 11, fill: "#52514e" }}
            tickLine={false}
            axisLine={{ stroke: "#c3c2b7" }}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "rgba(0, 0, 0, 0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Datum;
              return (
                <div className="chart-tip">
                  <div className="tip-head">
                    {format(d.lo)} – {format(d.hi)}
                  </div>
                  <div>
                    <strong>{d.count.toLocaleString()}</strong> of {runs.toLocaleString()} runs (
                    {((100 * d.count) / runs).toFixed(1)}%)
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="count"
            fill={color}
            fillOpacity={0.85}
            radius={[3, 3, 0, 0]}
            activeBar={{ fillOpacity: 1 }}
            isAnimationActive={false}
          />
          {MARKERS.map((m) => (
            <ReferenceLine
              key={m.p}
              x={binOf(values[m.p])}
              stroke="#1f1f1d"
              strokeDasharray={m.p === "P50" ? undefined : "4 3"}
              strokeWidth={m.p === "P50" ? 2 : 1.25}
              label={{ value: m.p, position: m.pos, fontSize: 11, fill: "#1f1f1d" }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
