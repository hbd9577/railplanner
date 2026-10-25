// Metric registry: one definition per figure the app shows, with its provenance. Every table,
// card, tooltip, export and the methodology page read from here, so labels and caveats stay consistent.
import type { RouteResult } from "./api";
import { count, hm, miles, money, pct, people, usd, years } from "./format";

export type Status = "observed" | "assumption" | "estimate" | "screening" | "not-modeled" | "unavailable";
export type Direction = "lower" | "higher" | "context";
export type Group =
  | "Service"
  | "Demand"
  | "Access"
  | "Infrastructure"
  | "Cost"
  | "Operations"
  | "Benefits"
  | "Schedule"
  | "Impacts"
  | "Funding";

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
const svc = (r: RouteResult) => (r.service && r.service.available ? r.service : null);
const SVC_SOURCE = "RailPlanner service model (data/service_parameters.json)";
const SVC_COVERAGE = "Stations on this alignment";
const SERVICE_PLAN =
  "The service plan set on the Service tab (default 8 daily round trips, 90 mph on existing rail, 125 mph on new track); every train stops at every station.";
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
    id: "tripTime", label: "End-to-end train time", short: "Train time", group: "Service", unit: "hours", direction: "lower",
    status: "estimate",
    definition: "Scheduled time from the first to the last station, including stops.",
    source: SVC_SOURCE, dataYear: "Assumed speeds", coverage: "This alignment",
    method: "Top speed by track type (lower on mountainous sections) times an average-speed factor, integrated over the alignment, plus a penalty per stop and per large-terminal approach.",
    assumptions: SERVICE_PLAN,
    uncertainty: "The average-speed factor (68-82% of top speed) is sampled; times vary by roughly 10% either way.",
    limitations: "Not a train performance simulation: curves, grades, signals, freight traffic and dispatching are not modeled.",
    get: (r) => num(svc(r)?.end_to_end_min), fmt: (v) => (Number.isFinite(v) ? hm(v) : "Not available"),
  },
  {
    id: "beatsCar", label: "Station pairs where rail beats driving door to door", short: "Beats driving", group: "Service", unit: "%",
    direction: "higher", status: "estimate",
    definition: "Share of station pairs on the line where the train trip, including getting to and from stations and waiting, is no slower than driving.",
    source: SVC_SOURCE, dataYear: "Assumed speeds", coverage: SVC_COVERAGE,
    method: "Rail: train time + 50 minutes to reach and leave stations + a quarter of the headway. Car: straight-line miles x 1.15 at 60 mph + 15 minutes.",
    assumptions: "Access time, road circuity and car speed are assumptions with ranges.",
    uncertainty: "Pairs near the break-even point can flip either way.",
    limitations: "Traffic congestion, parking cost and travel-time reliability are not represented.",
    get: (r) => (svc(r) ? svc(r)!.share_pairs_faster_than_car * 100 : NaN), fmt: safe((v) => pct(v)),
  },
  {
    id: "riders", label: "Annual riders (median)", short: "Riders", group: "Demand", unit: "trips per year", direction: "higher",
    status: "estimate",
    definition: "Modeled one-way trips per year between stations on this line, in the median simulation.",
    source: "Demand model calibrated to Amtrak FY2024 station ridership", dataYear: "FY2024 ridership; 2020 Census",
    coverage: SVC_COVERAGE,
    method: "Trips between each station pair grow with the populations near both stations and with frequency, and fall as rail gets slower relative to the faster of driving or flying. Scale and sensitivities fitted to 12 Amtrak stations.",
    assumptions: "Frequency elasticity 0.3-0.7; capped at an average load of 75% of seats; mature ridership (year 3 onward).",
    uncertainty: "Wide: the middle 80% of simulated outcomes spans roughly half to double the median, from the leave-one-out fit error.",
    limitations: "Not a mode-choice forecast: fares, time of day, transfers, bus competition and induced travel are not modeled separately.",
    get: (r) => num(svc(r)?.riders?.p50), fmt: safe(people),
  },
  {
    id: "revenue", label: "Annual fare revenue (median)", short: "Fare revenue", group: "Operations", unit: "US$ per year", direction: "higher",
    status: "estimate",
    definition: "Passenger-miles times fare revenue per passenger-mile.",
    source: "Amtrak FY2024 route results (ticket revenue of $0.21-$0.38 per passenger-mile)", dataYear: "FY2024",
    coverage: SVC_COVERAGE, method: "Modeled passenger-miles x sampled fare per passenger-mile.",
    assumptions: "Fares like those on Amtrak routes in this region in FY2024.",
    uncertainty: "Carries the full ridership uncertainty.", limitations: "No fare policy or yield management.",
    get: (r) => num(svc(r)?.revenue?.p50), fmt: safe(usd),
  },
  {
    id: "opex", label: "Annual operating cost (median)", short: "Operating cost", group: "Operations", unit: "US$ per year", direction: "lower",
    status: "estimate",
    definition: "Train-miles operated per year times fully allocated operating cost per train-mile.",
    source: "Amtrak FY2024 route results (operating expense of $56-$98 per train-mile)", dataYear: "FY2024",
    coverage: SVC_COVERAGE, method: "Daily round trips x 2 x route miles x 365 x sampled cost per train-mile.",
    assumptions: SERVICE_PLAN, uncertainty: "About 25% either way, from the range of observed route costs.",
    limitations: "Host-railroad access fees and new maintenance facilities are not itemized.",
    get: (r) => num(svc(r)?.opex?.p50), fmt: safe(usd),
  },
  {
    id: "subsidy", label: "Annual operating subsidy (median)", short: "Subsidy", group: "Operations", unit: "US$ per year", direction: "lower",
    status: "estimate",
    definition: "Operating cost minus fare revenue: the yearly support a state or sponsor would need. Negative means an operating surplus.",
    source: SVC_SOURCE, dataYear: "FY2024 cost and fare levels", coverage: SVC_COVERAGE,
    method: "Computed in each simulation, then the median taken.",
    assumptions: SERVICE_PLAN, uncertainty: "Combines ridership, fare and cost uncertainty.",
    limitations: "Excludes capital renewals and debt service.",
    get: (r) => num(svc(r)?.subsidy?.p50), fmt: safe(money),
  },
  {
    id: "trainsets", label: "Trainsets needed", group: "Operations", unit: "trainsets", direction: "lower", status: "estimate",
    definition: "Trainsets to run the service plan, including spares.",
    source: SVC_SOURCE, dataYear: "Assumed", coverage: "This alignment",
    method: "Round-trip cycle time (two end-to-end trips plus 40-minute turnarounds) divided by the headway, plus 15% spares (at least one).",
    assumptions: SERVICE_PLAN, uncertainty: "Small; depends on train time.", limitations: "No maintenance-cycle or peak planning.",
    get: (r) => num(svc(r)?.trainsets), fmt: safe((v) => count(v)),
  },
  {
    id: "bcr", label: "Benefit-cost ratio at 7% (median)", short: "Benefit-cost ratio", group: "Benefits", unit: "ratio", direction: "higher",
    status: "estimate",
    definition: "Present value of benefits divided by present value of costs over 30 years of operation, discounted at 7% as in USDOT's 2026 guidance. Above 1 means benefits exceed costs.",
    source: "USDOT Benefit-Cost Analysis Guidance, 2026 update", dataYear: "2024 dollars",
    coverage: "This alignment",
    method: "Benefits: rule-of-half user savings against driving, fare revenue, and fatal crashes avoided on diverted car miles. Costs: capital (from the cost simulation), trainsets, operations and renewals.",
    assumptions: "Capital spent over the last 60% of delivery; ridership ramps up over three years; 70% of riders would otherwise drive.",
    uncertainty: "Combines cost, schedule and ridership uncertainty.",
    limitations: "Omits injury and property-damage crashes, air pollutants, reliability, wider economic effects and residual value, so it is conservative. Carbon is not monetized under the 2026 guidance. Not an official benefit-cost analysis.",
    get: (r) => num(svc(r)?.bcr?.p50), fmt: safe((v) => v.toFixed(2)),
  },
  {
    id: "co2", label: "CO2 avoided per year (median)", short: "CO2 avoided", group: "Impacts", unit: "tonnes per year", direction: "higher",
    status: "estimate",
    definition: "Car CO2 avoided by riders who would otherwise drive, minus the diesel trains' own CO2. Negative means the service adds emissions.",
    source: "US EPA (400 g CO2 per car-mile; 10,180 g per gallon of diesel); ORNL Transportation Energy Data Book (Amtrak energy per railcar-mile)",
    dataYear: "EPA current; TEDB 2019", coverage: SVC_COVERAGE,
    method: "Diverted car-miles x 400 g, minus train-miles x six cars x energy per railcar-mile converted to diesel.",
    assumptions: "Diesel trains; 70% of riders would otherwise drive, at 1.52 people per car.",
    uncertainty: "Follows ridership uncertainty.", limitations: "No electrification, credit for air trips avoided, or construction emissions.",
    get: (r) => num(svc(r)?.co2_tonnes?.p50), fmt: safe((v) => `${count(v)} t`),
  },
  {
    id: "fatalities", label: "Road deaths avoided per year (median)", short: "Deaths avoided", group: "Impacts", unit: "deaths per year",
    direction: "higher", status: "estimate",
    definition: "Expected traffic deaths avoided on car miles that shift to rail.",
    source: "NHTSA 2023 (1.26 deaths per 100 million vehicle-miles)", dataYear: "2023", coverage: SVC_COVERAGE,
    method: "Diverted car-miles x national fatality rate.",
    assumptions: "The national average rate applies to these trips.", uncertainty: "Follows ridership uncertainty.",
    limitations: "Injuries and grade-crossing risk are not included.",
    get: (r) => num(svc(r)?.fatalities_avoided?.p50), fmt: safe((v) => v.toFixed(1)),
  },
  {
    id: "freightShare", label: "Route on freight-owned track", short: "Freight-owned", group: "Infrastructure", unit: "%",
    direction: "lower", status: "screening",
    definition: "Share of the alignment within about 1 km of an active line owned by a freight railroad. A risk indicator for access terms, capacity and reliability, not a measure of them.",
    source: "BTS NTAD North American Rail Network Lines (owner field)", dataYear: "NTAD current release", coverage: GRID,
    method: "Points every mile along the alignment matched to the nearest NTAD line within about 1 km.",
    assumptions: "Lines owned by Amtrak or commuter agencies count as passenger-owned.",
    uncertainty: "Parallel lines can be matched to the wrong owner.", limitations: "Trackage rights and dispatching control are not represented.",
    get: (r) => (svc(r) ? svc(r)!.freight_share * 100 : NaN), fmt: safe((v) => pct(v)),
  },
  {
    id: "singleTrack", label: "Single-track share of existing rail used", short: "Single track", group: "Infrastructure", unit: "%",
    direction: "lower", status: "screening",
    definition: "Of the existing rail the alignment follows, the share recorded as single track. Single track limits how many trains can run.",
    source: "BTS NTAD North American Rail Network Lines (track count field)", dataYear: "NTAD current release", coverage: GRID,
    method: "Track count of the matched NTAD line, where recorded.",
    assumptions: "Lines without a recorded track count are left out.",
    uncertainty: "Track counts are missing for many lines.", limitations: "Sidings and passing loops are not counted.",
    get: (r) => (svc(r)?.single_track_share != null ? svc(r)!.single_track_share! * 100 : NaN), fmt: safe((v) => pct(v)),
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
  { id: "timetable", label: "Timetable, time of day and stopping patterns", group: "Service",
    why: "Departure times and express versus local patterns decide which trips are practical; an overnight train serves few people.",
    needs: "A timetable, stopping-pattern options and demand by time of day." },
  { id: "reliability", label: "Reliability and on-time performance", group: "Service",
    why: "Shared track with freight is the main source of intercity delay in the US. Amtrak's FY2024 on-time performance on routes in this region ranged from 70% to 92%.",
    needs: "Operations simulation with freight traffic, dispatching rules and recovery time." },
  { id: "capacity", label: "Line capacity, freight conflicts and access agreements", group: "Infrastructure",
    why: "Existing corridors are mostly freight-owned; added passenger trains often need sidings, second tracks and negotiated access.",
    needs: "Host-railroad traffic data, capacity modeling and negotiated access terms." },
  { id: "competition", label: "Detailed competition with air, bus and driving", group: "Demand",
    why: "Fares, parking costs, congestion and airline schedules shift demand between modes.",
    needs: "A calibrated mode-choice model with fares and costs for every mode." },
  { id: "facilities", label: "Electrification, maintenance facilities and overhauls", group: "Cost",
    why: "These can add hundreds of millions of dollars and change emissions.",
    needs: "A fleet plan, facility sites and a traction power choice." },
  { id: "widerBenefits", label: "Injuries, air pollutants and wider economic effects", group: "Benefits",
    why: "Left out of the benefit-cost ratio, which is therefore conservative.",
    needs: "Crash data by severity, emission factors by mode, and regional economic analysis." },
];
