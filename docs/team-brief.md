# RailPlanner: team brief

What we built, how it works, the numbers to quote, and answers to likely judge questions.

## The one-liner

**RailPlanner turns "should we build passenger rail between these two cities?" into a fast, honest
comparison of three real alternatives: cost and schedule ranges, likely riders, operating subsidy,
federal funding fit, and a drafted proposal. Every number shows where it came from and how sure we are.**

## The problem

Before a state spends about $500K and two years on a federal Corridor ID study, planners have no quick way to
compare options. Back-of-envelope numbers are single points with no uncertainty and no sources. AI tools will
happily invent figures. We wanted a screening tool that is fast, but never pretends to know more than it does.

## What a user does (the demo)

1. Type two cities (17 supported, New York/Philadelphia to Chicago), or click them on the map.
2. RailPlanner draws **three alternatives** on a satellite map and animates the track being built, mile by
   mile. The three are: upgrade existing rail, a new direct line, and a route via intermediate cities. Long
   corridors use named routes instead, e.g. Lake Shore vs Pennsylvania vs direct for New York–Chicago.
3. The overlay says which alternative **leads under the current priorities**, with median cost and time to
   opening, their ranges, why it leads, and preliminary riders and subsidy.
4. Tabs go deeper:
   - **Service & demand:** change trains per day or top speed, and ridership, finances and fleet re-run.
   - **Comparison:** one table of every measure, with how each figure was produced.
   - **Costs & schedule:** histograms, budget checks and 30-year benefit-cost.
   - **Impacts:** environment, CO2 and safety.
   - **Funding:** the six federal programs, verified against official pages.
   - **Proposal & questions:** a Gemini-drafted proposal and Q&A.
   - **Methodology:** every input and its source.
5. Adjust priorities with sliders: the ranking updates and explains why the leader changed. Save, share a
   link, or export a PDF, HTML or CSV report.

## How it works (the pipeline)

| Step | What happens | Key detail |
|---|---|---|
| **Data** | Five public sources rasterized onto a 1 km grid | BTS national rail network, 2020 Census tracts, USGS elevation, USGS protected areas (PAD-US), Natural Earth water. Pruned to the study region, stored as `grid.npz` |
| **Routing** | Each 1 km cell is a node with a travel cost; least-cost path (Dijkstra on an 8-connected grid) | Cost depends on slope, existing rail (discounted), protected land and floodplain (penalized), rivers (bridge penalty), population and length. Each alternative weights these differently |
| **Measures** | Length, share on existing rail, new-track miles, stations in route order, residents near stations, flagged environmental miles, river crossings | Stations are our cities within 5 km of the line; residents counted within 10 km of stations, each person once |
| **Cost and schedule** | **5,000 Monte Carlo runs per alternative** (PERT and triangular distributions) | Runs are bulk-loaded into a **TimescaleDB hypertable** in Tiger Data; a **continuous aggregate** builds histograms that give P10/P50/P90 |
| **Service and demand** | Train times, door-to-door vs driving and flying, ridership, fares, operating cost, subsidy, fleet, CO2, road deaths, benefit-cost ratio | Ridership calibrated to **Amtrak FY2024 ridership at 12 stations**; 2,000 simulations give ranges |
| **Funding** | Screens six federal programs | Facts checked against FRA/USDOT pages on 2026-10-24; never adds program amounts together |
| **Proposal and Q&A** | **Gemini** writes the proposal from our computed figures only | A **number check** rejects any number not in our results, retries once, then falls back to a template |
| **Ranking** | Weighted score from sliders (cost, delivery, riders, train time, subsidy, environment...) | Shows sensitivity: how far each slider can move before the leader changes |

## Numbers worth quoting

**New York → Chicago** (default service: 8 trains a day each way)

| | Lake Shore upgrade | Pennsylvania upgrade | New direct high-speed |
|---|---|---|---|
| Capital cost, median (P10–P90) | $25.2B ($20.3–31.4B) | $24.3B ($19.7–30.2B) | $35.5B ($29.6–42.2B) |
| Time to opening, median | 17.8 yr | 15.8 yr | 18.0 yr |
| Train time end to end | 15 h 19 min | 13 h 36 min | 9 h 08 min |
| Riders a year, median (P10–P90) | 2.21M (1.04–3.72M) | 1.84M (0.87–3.89M) | 253K (121–540K) |
| Operating subsidy a year, median | $198M | $227M | $267M |

- Lake Shore leads under the default priorities: it has the most riders and the lowest subsidy.
- **Talking point:** the direct line saves about 3½ hours over driving door to door, but it draws the fewest
  riders. Its only stations are New York and Chicago, and flying that trip takes about 5 hours door to door.
  Speed alone doesn't make a useful corridor; intermediate cities do.
- **Poughkeepsie → Chicago:** existing corridor upgrade $27.5B ($22.1–33.9B), 17.0 years (14.9–19.2).
- **Benefit-cost ratios are well below 1 at USDOT's 7% discount rate.** This is honest, not a bug: costs are
  huge, benefits start 15+ years out, and we leave out several benefit types.

## Why judges should trust it

- **Labels on everything.** Every figure is one of: Observed, User assumption, Modeled estimate, Preliminary
  screening indicator, Not modeled, or Not available. The "?" next to a measure shows its definition,
  source, data year, method, assumptions, uncertainty and limitations.
- **Ranges, not single numbers.** P10–P90 is "the middle 80% of modeled outcomes".
- **Missing data never helps.** A missing value is excluded from the ranking instead of counted as zero.
- **The AI can't invent numbers.** Gemini only sees our pre-formatted figures, and every number in its output
  is checked against them.
- **Real calibration, with the error shown.** The ridership model is fitted to real Amtrak data, and the
  app shows the station-by-station fit.
- **We say what's not modeled.** Timetables, reliability, line capacity, injuries and pollutants.

## Sponsor and technology usage

- **Tiger Data** (Postgres 18 + TimescaleDB 2.31 + PostGIS 3.6):
  - plans, routes and funding matches are stored as tables;
  - 5,000 runs per route are COPY-loaded into the `simulation_runs` hypertable;
  - the `route_sim_stats` continuous aggregate computes histograms (log-scale cost bins, half-month duration bins), from which we read P10/P50/P90.
- **Google Gemini** (3.5 Flash): structured JSON output, a number-check guardrail, and context-aware Q&A.
- **Vultr:** a VM running Docker Compose with Caddy, an nginx frontend and a FastAPI API.
- **Frontend:** React 18, TypeScript, Vite, Leaflet (Esri satellite tiles), p5.js (track-building animation), Recharts.
- **Backend:** FastAPI, NumPy, SciPy, scikit-image (least-cost paths), Shapely, pyproj; GeoPandas and rasterio for data preparation.

## Likely questions and our answers

**Where do the costs come from?**
Per-mile benchmarks by terrain, density and track type (new, upgrade, reactivation), plus tunnels, grade
separations, bridges, stations, a market factor and 15–30% contingency. The benchmarks are illustrative
placeholders bracketed by reported US projects, and the app says so everywhere. Calibrating them to real
project costs is our top next step.

**What does P10/P50/P90 mean?**
Of 5,000 simulated outcomes, 10% fall below P10 and 10% above P90. P50 is the median. It describes
uncertainty within our model's assumptions, not a guarantee.

**How do you predict ridership?**
A gravity model. Trips between two stations grow with the populations near both, and with train frequency.
They fall as rail gets slower relative to the faster of driving or flying, and with distance. We fitted the
scale, the time sensitivity and the distance decay to Amtrak's FY2024 boardings at 12 stations.
- The typical miss is ×1.5 in the fit, and ×1.8 when a station is left out of the fit.
- That's why ranges are wide (roughly half to double the median).
- Known misses: Albany and Pittsburgh have other trains we don't model. Lake Shore stations are served
  overnight, which a gravity model can't see.

**Why use Tiger Data / TimescaleDB for a simulation?**
Monte Carlo runs are a natural time series: 15,000 rows per plan, with continuous aggregation. The continuous
aggregate keeps histograms up to date as runs arrive, so percentiles come straight from the database instead
of re-scanning raw runs. PostGIS stores route geometry.

**How do you stop Gemini from making things up?**
1. Gemini only receives figures we computed, already formatted ("$24.3B", "15.8 years").
2. It returns structured sections; we add headings and disclaimers ourselves.
3. A regex extracts every number from its output and checks each against our data. On a mismatch it retries
   once, then falls back to a deterministic template.

**Is the benefit-cost ratio official?**
No. It is a screening estimate using USDOT's 2026 guidance values:
- $28.20/hour for intercity personal travel time;
- $0.56 per vehicle-mile operating cost;
- $15.37M per fatal crash;
- a 7% discount rate, with 3.1% shown for comparison;
- 30 years of operation.

It omits injuries, pollutants and wider economic effects, so it is conservative. USDOT no longer monetizes
carbon, so we report CO2 in tonnes.

**How is funding "fit" scored? Is it a probability?**
No. It is a fixed rule per program (shown on each card): project type, size and location. It is not a
probability of award. Program facts (applicants, match, status, deadlines) were checked against FRA and USDOT
pages. All current rounds are closed, with selections announced in Aug–Oct 2026, so the real next step is
Corridor ID.

**Does being on existing rail mean you can use it?**
No, and the app says so. Most of those corridors are freight-owned. We show the share on freight-owned and
single track as a warning sign; access, capacity and reliability need negotiation and operations
simulation.

**What would you build next?**
- Calibrated cost data.
- A timetable and operations simulation for reliability and capacity.
- Better demand data (station-pair trips, fares, mode choice).
- Editable stops.
- Coverage beyond the Northeast–Midwest region.

## Honest limits (say these before judges find them)

- Costs are illustrative; alignments are conceptual paths on a 1 km grid, not engineering.
- Service estimates are preliminary: every train stops everywhere, with no timetable, reliability or capacity analysis.
- 17 cities, New York/Philadelphia to Chicago only.
- Voice narration (ElevenLabs) was planned but skipped.

## Glossary

- **ROW (right-of-way):** the land a railroad runs on.
- **Corridor ID:** FRA's planning pipeline; the entry point for federal intercity rail capital funding.
- **FSP:** Federal-State Partnership for Intercity Passenger Rail, FRA's main capital grant program.
- **Hypertable:** a TimescaleDB table automatically partitioned by time.
- **Continuous aggregate:** a TimescaleDB materialized view that refreshes incrementally.
- **Load factor:** the share of seats filled. We cap ridership at 75%.
- **Subsidy:** operating cost minus fare revenue; negative means an operating surplus.
