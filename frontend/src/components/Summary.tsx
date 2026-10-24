import type { PlanResult, RouteResult } from "../api";
import { ROUTE_COLORS, people, usd, years } from "../format";

interface Leader {
  idx: number;
  clause: string;
}

function leader(routes: RouteResult[], pick: (r: RouteResult) => number, best: "max" | "min"): number {
  const vals = routes.map(pick);
  return vals.indexOf(best === "max" ? Math.max(...vals) : Math.min(...vals));
}

// A short written read-out of the results, built only from computed values.
export default function Summary({ plan, onSelect }: { plan: PlanResult; onSelect: (i: number) => void }) {
  const r = plan.routes;
  const facts: Leader[] = [
    { idx: leader(r, (x) => x.stats.score, "max"), clause: "" },
    { idx: leader(r, (x) => x.simulation.cost.p50, "min"), clause: "" },
    { idx: leader(r, (x) => x.simulation.duration.p50, "min"), clause: "" },
    { idx: leader(r, (x) => x.stats.population_served, "max"), clause: "" },
  ];
  facts[0].clause = `the highest composite score (${r[facts[0].idx].stats.score.toFixed(1)})`;
  facts[1].clause = `the lowest median cost (${usd(r[facts[1].idx].simulation.cost.p50)})`;
  facts[2].clause = `the shortest median time to opening (${years(r[facts[2].idx].simulation.duration.p50)})`;
  facts[3].clause = `the most residents within ${r[facts[3].idx].stats.buffer_miles.toFixed(0)} miles (${people(
    r[facts[3].idx].stats.population_served,
  )})`;

  // Group clauses by route so a route that leads on several measures reads as one sentence.
  const byRoute = new Map<number, string[]>();
  for (const f of facts) byRoute.set(f.idx, [...(byRoute.get(f.idx) ?? []), f.clause]);
  const join = (xs: string[]) => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  return (
    <div className="summary">
      <p className="summary-lede">
        {r.length} alternatives between {plan.origin.name} and {plan.destination.name}.
      </p>
      {[...byRoute.entries()].map(([i, clauses]) => (
        <p key={i}>
          <button className="inline-route" onClick={() => onSelect(i)}>
            <span className="num" style={{ background: ROUTE_COLORS[i] }}>
              {r[i].rank}
            </span>
            {r[i].label}
          </button>{" "}
          has {join(clauses)}.
        </p>
      ))}
    </div>
  );
}
