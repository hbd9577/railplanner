<!--
Devpost fields
  Project name: RailPlanner
  Tagline (under 200 characters): Compare passenger rail corridors in seconds: real-data routes, cost and schedule ranges, ridership, funding fit and an AI-drafted proposal that can't invent numbers.
  Built with: react, typescript, vite, leaflet, p5.js, recharts, python, fastapi, numpy, scipy, scikit-image, shapely, geopandas, postgresql, timescaledb, postgis, tiger-data, gemini, docker, caddy, nginx, vultr
  Try it out: http://45.77.76.26 · https://github.com/hbd9577/railplanner
Paste everything below into "About the project" (Markdown).
-->

## Inspiration

Before a state can win federal money for a new passenger rail line, it typically spends about $500,000 and
two years on a planning study just to learn whether the idea is worth pursuing. Early conversations run on
back-of-envelope guesses with no ranges and no sources. Meanwhile, AI tools will confidently make up numbers.
We wanted a tool that answers "is this corridor worth a closer look?" in seconds, and is honest about what it
doesn't know.

## What it does

Pick two of 17 cities between New York/Philadelphia and Chicago. RailPlanner:

- 🗺️ **Draws three alternatives on a satellite map**, built from real rail, terrain, population and
  protected-land data: upgrade existing rail, a new direct line, and a route through intermediate cities.
  The track is animated being laid mile by mile.
- 🎲 **Simulates cost and schedule 5,000 times per alternative** and shows the median with the middle 80% of
  outcomes, not a single made-up number.
- 🚆 **Estimates the service.** Train times, door-to-door trips against driving and flying, annual riders,
  fare revenue, operating subsidy, trainsets, CO2, road deaths avoided, and a 30-year benefit-cost ratio.
  Ridership is **calibrated to Amtrak's real FY2024 ridership**. Change trains per day or top speed and
  everything re-runs.
- ⚖️ **Ranks the options by your priorities.** Sliders for cost, speed of delivery, riders, train time,
  subsidy and environment. The ranking explains why the leader changes, and how far each priority can move
  before it does.
- 💵 **Screens six federal funding programs**, with facts checked against official FRA and USDOT pages:
  applicants, match, status, deadlines, sources and next steps.
- ✍️ **Drafts a proposal with Gemini that cannot invent numbers.** Every figure in the draft is checked
  against our computed results. Ask questions and get short, sourced answers.
- 🔎 **Shows its work.** Every figure is labeled Observed, Modeled estimate, Screening indicator, User
  assumption, Not modeled or Not available, with its source, year, method and limits one click away.
- 📤 **Lets you save, share or export.** Share a link, compare saved scenarios, or export PDF, HTML and CSV
  reports.

**Example: New York → Chicago.** Upgrading the Lake Shore route leads under the default priorities: about
$25.2B and 17.8 years to open, roughly 2.2M riders a year, and a $198M yearly operating subsidy. The new
direct high-speed line is 6 hours faster on the train, but draws only about 250K riders, because with no
stops in between it competes head-on with a roughly 5-hour flight. **Speed alone doesn't make a useful
corridor; the cities in between do.**

## How we built it

- **Data:** rail lines (BTS), 2020 Census tracts, USGS elevation and USGS protected areas (PAD-US), and
  Natural Earth water, rasterized onto a 1 km grid with Python (GeoPandas, rasterio).
- **Routing:** every grid cell is a node with a travel cost based on slope, existing rail, protected land,
  rivers and population. scikit-image finds least-cost paths, with a different weighting for each
  alternative.
- **Tiger Data (TimescaleDB + PostGIS):**
  - Plans and routes are stored, with PostGIS geometry.
  - The 5,000 Monte Carlo runs per route are bulk-loaded with `COPY` into a **hypertable**.
  - A **continuous aggregate** keeps cost and duration histograms up to date, and we read P10/P50/P90
    straight from it.
- **Service model:** a gravity demand model fitted to Amtrak FY2024 boardings at 12 stations. Fares and
  operating costs come from Amtrak's FY2024 route results, and benefit-cost values from USDOT's 2026
  guidance. A second Monte Carlo (2,000 runs) produces the ranges.
- **Gemini:**
  - It receives only pre-formatted figures we computed and returns structured JSON sections.
  - A number-check guardrail extracts every number from its output and rejects anything not in our results.
  - It retries once, then falls back to a deterministic template.
- **Frontend:** React, TypeScript and Vite; Leaflet for the satellite map, p5.js for the track-building
  animation, Recharts for histograms.
- **Deployment:** Docker Compose on a **Vultr** VM, with Caddy in front of an nginx static build and a
  FastAPI API.

## Challenges we ran into

- **Keeping the AI honest.** Gemini would round, add or invent figures. The number check, structured output
  and template fallback were what made it trustworthy enough to show.
- **Our first ridership model was badly wrong.** It forecast 3.7M New York–Chicago riders because it only
  compared trains with cars. Adding flying as a competitor, and capping ridership at the seats actually
  offered, brought it in line with reality.
- **A "maximize population" route that zigzagged** across Pennsylvania and New York. We rewrote it to route
  through intermediate cities within a 25% detour.
- **Misleading metrics.** "Population served" counted people near the track who had no station. We split it
  into residents near the line and residents near stations, and stopped counting anyone twice.
- **Infrastructure snags:** Windows path-length limits breaking the database driver, a Census API that
  needed a key, elevation downloads timing out, and networks that block SSH and database ports.

## Accomplishments that we're proud of

- A ridership model calibrated to real Amtrak data that **shows its own error**, station by station.
- AI-written proposals where **every number is verified** against computed results.
- Real use of **TimescaleDB**: hypertables and continuous aggregates for simulation results.
- **Honesty built into the interface:** status labels, ranges, sources and a clear list of what isn't
  modeled, so a leading score is never mistaken for "feasible" or "fundable".

## What we learned

- Uncertainty is the product. Planners need ranges and sources more than they need a single answer.
- Infrastructure questions are really service questions. Cost per mile matters less than how often trains run,
  how fast door to door, and between which cities.
- Large language models are most useful when they write words around numbers they are not allowed to change.

## What's next for RailPlanner

- Calibrate costs to real project data, such as FRA corridor studies and the Transit Costs Project.
- Add timetables and an operations simulation for reliability and line capacity on freight-owned track.
- Improve demand with station-pair trip data, fares and air and bus competition.
- Make stops and stations editable, and support user-set cost inputs.
- Cover the whole country, and add voice narration of proposals.

> RailPlanner is a screening tool. Costs use illustrative benchmarks and service estimates are preliminary;
> it's built to decide what deserves a real study, not to replace one.
