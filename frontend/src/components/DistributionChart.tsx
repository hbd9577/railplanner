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

// Histogram of Monte Carlo runs with P10/P50/P90 markers. Bins come from the
// TimescaleDB continuous aggregate (or the identical local fallback).
export default function DistributionChart({ title, dist, color, format, runs }: Props) {
  const data: Datum[] = dist.histogram.map((b, i) => ({ key: String(i), lo: b.lo, hi: b.hi, count: b.count }));
  const binOf = (v: number) => {
    const i = data.findIndex((d) => v >= d.lo && v < d.hi);
    return String(i === -1 ? (v < data[0].lo ? 0 : data.length - 1) : i);
  };
  const markers = [
    { p: "P10", v: dist.p10 },
    { p: "P50", v: dist.p50 },
    { p: "P90", v: dist.p90 },
  ];

  return (
    <figure className="dist">
      <figcaption>
        <span className="dist-title">{title}</span>
        <span className="dist-values">
          {markers.map((m) => (
            <span key={m.p} className={m.p === "P50" ? "p50" : ""}>
              {m.p} <strong>{format(m.v)}</strong>
            </span>
          ))}
        </span>
      </figcaption>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="#e8e7e3" />
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
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Datum;
              return (
                <div className="chart-tip">
                  <div>
                    {format(d.lo)} – {format(d.hi)}
                  </div>
                  <div className="muted">
                    {d.count.toLocaleString()} runs ({((100 * d.count) / runs).toFixed(1)}%)
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          {markers.map((m) => (
            <ReferenceLine
              key={m.p}
              x={binOf(m.v)}
              stroke="#0b0b0b"
              strokeDasharray={m.p === "P50" ? undefined : "3 3"}
              strokeWidth={m.p === "P50" ? 2 : 1}
              label={{ value: m.p, position: "top", fontSize: 11, fill: "#0b0b0b" }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
