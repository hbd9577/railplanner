// Metric registry: one definition per figure the app shows, with its provenance. Every table,
// card, tooltip, export and the methodology page read from here, so labels and caveats stay consistent.
import type { RouteResult } from "./api";
import { miles, pct, people, usd, years } from "./format";

export type Status = "observed" | "assumption" | "estimate" | "screening" | "not-modeled" | "unavailable";
export type Direction = "lower" | "higher" | "context";
export type Group = "Service" | "Demand" | "Access" | "Infrastructure" | "Cost" | "Schedule" | "Impacts" | "Funding";

export const STATUS_LABEL: Record<Status, string> = {
  observed: "Observed",
  assumption: "User assumption",
  estimate: "Modeled estimate",
  screening: "Preliminary screening indicator",
  "not-modeled": "Not modeled",
  unavailable: "Not available",
};

export const STATUS_HELP: Record<Status, string> = {
  observed: "Taken directly from a published data source (for example Census population or the national rail network), without modeling.",
  assumption: "A value you set, such as a priority weight, budget or target date. Results that depend on it change when you change it.",
  estimate: "Produced by RailPlanner's Monte Carlo model from uncalibrated, illustrative inputs. Useful for comparing alternatives, not for budgeting.",
  screening: "Measured from public data along a conceptual alignment. Good for spotting differences between alternatives; not an engineering, environmental or eligibility finding.",
  "not-modeled": "RailPlanner does not estimate this yet. It matters to the decision and needs the inputs listed.",
  unavailable: "The value is missing for this alternative, so it is left out of rankings rather than treated as zero.",
};

export interface Metric {
  id: string;
  label: string;
  short?: string;
  group: Group;
  unit: string;
  direction: Direction;
  status: Status;
  definition: string;
  source: string;
  dataYear: string;
  coverage: string;
  method: string;
  assumptions: string;
  uncertainty: string;
  limitations: string;
  get: (r: RouteResult) => number; // NaN when the value is missing
  fmt: (v: number) => string;
}

const GRID = "1 km analysis grid covering New York City/Philadelphia to Chicago";
const ALIGN = "The alignment is a conceptual least-cost path on 1 km cells, not an engineered design.";

/** Missing values become NaN so they can never rank as the best (lowest) value. */
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const safe = (fmt: (v: number) => string) => (v: number) => (Number.isFinite(v) ? fmt(v) : "Not available");

export const METRICS: Metric[] = [
  {
    id: "length", label: "Alignment length", group: "Infrastructure", unit: "miles", direction: "context",
    status: "screening",
    definition: "Length of the conceptual alignment from origin to destination. Shorter often allows faster trips, but only an operations model can say how fast.",
    source: "Least-cost routing over BTS NTAD rail, USGS 3DEP terrain, Census 2020 population and PAD-US", dataYear: "2020 Census; NTAD and PAD-US current releases",
    coverage: GRID, method: "Smoothed least-cost path across 1 km cells; length of the smoothed line.",
    assumptions: "Routing costs favor existing rail, flat terrain and avoiding protected land, with weights that differ by strategy.",
    uncertainty: "Limited by the 1 km grid; a real alignment with curve and grade limits would usually be somewhat longer.",
    limitations: ALIGN,
    get: (r) => num(r.stats.length_miles), fmt: safe(miles),
  },
  {
    id: "row", label: "Share on existing rail corridors", short: "On existing rail", group: "Infrastructure", unit: "%",
    direction: "context", status: "screening",
    definition: "Share of the path that runs along existing (active or inactive) rail right-of-way.",
    source: "BTS NTAD North American Rail Network Lines", dataYear: "NTAD current release",
    coverage: "US rail lines in the analysis region", method: "Share of path cells that touch an NTAD rail line.",
    assumptions: "Any NTAD line counts, whatever its owner, condition or traffic.",
    uncertainty: "1 km cells can count a parallel road or line as on-corridor.",
    limitations: "Does not establish ownership, access rights, spare capacity, track condition or permission to operate passenger trains.",
    get: (r) => num(r.stats.row_reuse_pct), fmt: safe((v) => pct(v, 1)),
  },
  {
    id: "newTrack", label: "New track off existing corridors", short: "New track", group: "Infrastructure", unit: "miles",
    direction: "lower", status: "screening",
    definition: "Miles that need new right-of-way: land acquisition, new structures and new environmental review.",
    source: "BTS NTAD rail lines", dataYear: "NTAD current release", coverage: GRID,
    method: "Path miles not on active or inactive rail right-of-way.",
    assumptions: "Existing right-of-way is assumed usable for added track without new land.",
    uncertainty: "Grid resolution; short connections and sidings are not captured.",
    limitations: "Added tracks within existing corridors, which are often needed for capacity, are not counted as new track.",
    get: (r) => num(r.stats.miles_new), fmt: safe(miles),
  },
  {
    id: "mountain", label: "New track in mountainous terrain", group: "Infrastructure", unit: "miles", direction: "lower",
    status: "screening",
    definition: "New-track miles where the mean slope is 8% or more. A proxy for tunnels, viaducts and heavy earthwork, not a structure count.",
    source: "USGS 3DEP elevation", dataYear: "3DEP current", coverage: GRID,
    method: "Mean slope of 250 m elevation samples per 1 km cell along new-track sections.",
    assumptions: "Slope classes: flat under 3%, rolling 3–8%, mountainous 8% or more.",
    uncertainty: "Cell averages smooth out ridges and valleys.",
    limitations: "No tunnel, bridge or grade design; maximum train grades are not checked.",
    get: (r) => num(r.stats.miles_new_mountainous), fmt: safe(miles),
  },
  {
    id: "rivers", label: "Major river crossings", group: "Infrastructure", unit: "crossings", direction: "lower",
    status: "screening",
    definition: "Times the path crosses a major river.",
    source: "Natural Earth 10m rivers", dataYear: "Natural Earth 5.x", coverage: "Major rivers only",
    method: "Entries into river cells along the path.",
    assumptions: "Crossings on existing rail are assumed to reuse (rehabilitate) the existing bridge.",
    uncertainty: "A meandering river near the path can add or remove a crossing.",
    limitations: "Smaller rivers, streams and wetlands are missed, so real crossing counts are higher.",
    get: (r) => num(r.stats.river_crossings), fmt: safe((v) => `${v}`),
  },
  {
    id: "stations", label: "Stations at known cities", short: "Stations", group: "Access", unit: "stations", direction: "context",
    status: "screening",
    definition: "RailPlanner's 17 cities that lie within 5 km of the alignment.",
    source: "RailPlanner city list", dataYear: "2020 Census populations", coverage: "17 cities in the region",
    method: "City point within 5 km of any path cell; ordered by distance along the route.",
    assumptions: "Every listed city near the line gets a station; no other stops.",
    uncertainty: "A city just beyond 5 km is left out.",
    limitations: "Real station sites, spacing, stopping patterns and smaller towns are not designed.",
    get: (r) => num(r.stats.stations?.length), fmt: safe((v) => `${v}`),
  },
  {
    id: "popStations", label: "Residents near stations", group: "Access", unit: "people", direction: "higher",
    status: "screening",
    definition: "Residents within 10 km (straight line) of any station, counted once where catchments overlap. A rough measure of who could reach the service; not a ridership forecast.",
    source: "US Census 2020 tracts (TIGERweb POP100)", dataYear: "2020", coverage: GRID,
    method: "Union of 10 km disks around station cells; sum of tract population rasterized to 1 km.",
    assumptions: "10 km straight-line catchment, the same for every station and city size.",
    uncertainty: "Tract population is spread evenly over each tract's cells.",
    limitations: "Ignores travel time to the station, transit connections, and whether people would ride.",
    get: (r) => num(r.stats.pop_near_stations), fmt: safe(people),
  },
  {
    id: "popLine", label: "Residents near the alignment", group: "Access", unit: "people", direction: "context",
    status: "screening",
    definition: "Residents within 10 miles of the line, whether or not a station is nearby. A line can pass a large metro area without serving it.",
    source: "US Census 2020 tracts (TIGERweb POP100)", dataYear: "2020", coverage: GRID,
    method: "10-mile buffer around path cells; sum of rasterized tract population.",
    assumptions: "10-mile buffer on both sides of the line.",
    uncertainty: "Tract population is spread evenly over each tract's cells.",
    limitations: "Not a ridership forecast and not used in the ranking, to avoid counting residents twice.",
    get: (r) => num(r.stats.population_served), fmt: safe(people),
  },
  {
    id: "cost", label: "Capital cost (median, P50)", short: "Capital cost", group: "Cost", unit: "US$", direction: "lower",
    status: "estimate",
    definition: "Median of 5,000 simulated capital costs.",
    source: "RailPlanner Monte Carlo (cost_benchmarks.csv)", dataYear: "Illustrative benchmarks; no cost year", coverage: "This alignment",
    method: "PERT draws per mile by terrain, density and treatment, plus heavy structures, grade separations, bridges, stations, a shared market factor and 15–30% contingency.",
    assumptions: "Per-mile benchmarks are placeholders bracketed by reported US projects; upgrading existing rail costs a fraction of new track.",
    uncertainty: "The P10–P90 range covers variation within these assumptions only.",
    limitations: "Excludes rolling stock, maintenance facilities, electrification, host-railroad access payments, financing and escalation.",
    get: (r) => num(r.simulation?.cost?.p50), fmt: safe(usd),
  },
  {
    id: "costSpread", label: "Cost range (P90 − P10)", group: "Cost", unit: "US$", direction: "lower", status: "estimate",
    definition: "Width of the middle 80% of simulated costs. Wider means less certain within the model's own assumptions.",
    source: "RailPlanner Monte Carlo", dataYear: "Illustrative benchmarks", coverage: "This alignment",
    method: "P90 minus P10 from the cost distribution.",
    assumptions: "Input ranges are judgment-based, not fitted to project outcomes.",
    uncertainty: "Itself an output of assumed input ranges.",
    limitations: "Says nothing about errors in the model's structure.",
    get: (r) => num(r.simulation?.cost?.p90) - num(r.simulation?.cost?.p10), fmt: safe(usd),
  },
  {
    id: "duration", label: "Time to opening (median, P50)", short: "Time to opening", group: "Schedule", unit: "years",
    direction: "lower", status: "estimate",
    definition: "Median simulated time from the start of planning and environmental review to opening.",
    source: "RailPlanner Monte Carlo", dataYear: "Illustrative durations", coverage: "This alignment",
    method: "Triangular durations for planning and review, land acquisition, design, procurement and construction, with overlaps; design and construction scale with simulated cost.",
    assumptions: "Funding is available when needed; long corridors are built as parallel segments of about 300 miles.",
    uncertainty: "The P10–P90 range covers variation within these assumptions only.",
    limitations: "No testing and commissioning stage, funding gaps, litigation or host-railroad negotiations.",
    get: (r) => num(r.simulation?.duration?.p50), fmt: safe(years),
  },
  {
    id: "envMiles", label: "Miles through flagged areas (all track)", group: "Impacts", unit: "miles", direction: "context",
    status: "screening",
    definition: "Path miles inside protected land, wildlife refuges or floodplain proxies, including existing track. A mile inside two layers counts in both.",
    source: "USGS PAD-US 3.0 (GAP 1–2 and refuges); Natural Earth rivers", dataYear: "PAD-US 3.0", coverage: GRID,
    method: "Path cells inside each flag layer, converted to miles.",
    assumptions: "Floodplain is approximated by a corridor around major rivers.",
    uncertainty: "Coarse layers at 1 km resolution.",
    limitations: "Not FEMA flood maps or a wetland inventory; flags show where to look, not impact severity.",
    get: (r) => (r.stats.env_miles ? Object.values(r.stats.env_miles).reduce((a, b) => a + b, 0) : NaN), fmt: safe(miles),
  },
  {
    id: "envNew", label: "Flagged miles on new track", group: "Impacts", unit: "miles", direction: "lower",
    status: "screening",
    definition: "Path miles inside protected land, wildlife refuges or floodplain proxies where new track would be built, each mile counted once.",
    source: "USGS PAD-US 3.0; Natural Earth rivers; BTS NTAD rail", dataYear: "PAD-US 3.0", coverage: GRID,
    method: "Path cells inside any flag layer and not on existing rail right-of-way, converted to miles.",
    assumptions: "Upgrading track that already runs through a flagged area is treated as no new exposure.",
    uncertainty: "Coarse layers at 1 km resolution.",
    limitations: "Work on existing track can still need environmental review; wetlands, habitat, historic sites and communities are not assessed.",
    get: (r) => num(r.stats.env_miles_new), fmt: safe(miles),
  },
  {
    id: "fundingTop", label: "Best federal program fit", group: "Funding", unit: "0–1", direction: "context",
    status: "screening",
    definition: "Highest qualitative fit among matched federal programs.",
    source: "funding_programs.json (program parameters with verification dates)", dataYear: "See Funding tab",
    coverage: "Six federal programs", method: "Rules on project type, size and corridor location.",
    assumptions: "Project type is inferred from the share on existing rail.",
    uncertainty: "Not a probability.",
    limitations: "Not an eligibility determination, award estimate or probability of funding.",
    get: (r) => (r.funding?.length ? Math.max(0, ...r.funding.filter((m) => m.eligible).map((m) => m.fit_score)) : NaN),
    fmt: safe((v) => v.toFixed(2)),
  },
];

export const METRIC = Object.fromEntries(METRICS.map((m) => [m.id, m])) as Record<string, Metric>;

/** Decision-critical information RailPlanner does not estimate. Shown wherever it would matter. */
export interface Gap {
  id: string;
  label: string;
  group: Group;
  why: string;
  needs: string;
}

export const NOT_MODELED: Gap[] = [
  { id: "travelTime", label: "Door-to-door and in-train travel time", group: "Service",
    why: "Decides whether rail competes with driving, bus or flying for each trip.",
    needs: "Track geometry and speed limits, stopping pattern, rolling-stock performance, station access times and comparable times for other modes." },
  { id: "frequency", label: "Frequency, span and timetable", group: "Service",
    why: "Two trains a day and twelve trains a day are different services with different users.",
    needs: "Service plan, fleet size, crew and maintenance windows, and host-railroad paths." },
  { id: "demand", label: "Ridership and station-pair demand", group: "Demand",
    why: "Population near a line is not passengers; revenue, benefits and subsidy all follow from demand.",
    needs: "Travel survey or mobile data, a calibrated mode-choice model, fares and the service plan." },
  { id: "competitiveness", label: "Travel-time competitiveness by station pair", group: "Demand",
    why: "Intermediate city pairs often carry most of a corridor's trips.",
    needs: "Travel times by station pair for rail, car, bus and air with consistent access assumptions." },
  { id: "reliability", label: "Reliability and on-time performance", group: "Service",
    why: "Shared track with freight is the main source of intercity delay in the US.",
    needs: "Operations simulation with freight traffic, dispatching rules and recovery time." },
  { id: "capacity", label: "Capacity, freight conflicts and access agreements", group: "Infrastructure",
    why: "Existing rail corridors are mostly privately owned; access, paths and added tracks drive cost and schedule.",
    needs: "Host-railroad traffic data, capacity modeling and negotiated access terms." },
  { id: "operating", label: "Operating cost, revenue and annual subsidy", group: "Cost",
    why: "Determines the ongoing public support a state or sponsor must commit to every year.",
    needs: "Service plan, crew and fleet costs, maintenance-of-way costs, fares and ridership." },
  { id: "lifecycle", label: "Lifecycle cost, rolling stock and facilities", group: "Cost",
    why: "Trains, maintenance facilities, electrification and renewals are excluded from the capital estimate.",
    needs: "Fleet plan, facility sites, traction power choice and an analysis period with renewals." },
  { id: "bca", label: "Benefit-cost ratio and net present value", group: "Cost",
    why: "Federal capital programs weigh public benefits against costs.",
    needs: "Ridership, travel-time savings, safety and emissions effects, discount rate and analysis period." },
  { id: "emissions", label: "Emissions, safety and resilience outcomes", group: "Impacts",
    why: "Net climate and safety benefits depend on mode shift and operations, not on the alignment alone.",
    needs: "Mode-shift estimates, energy and fuel mix, grade-crossing exposure, hazard data." },
];
