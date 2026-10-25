"""Preliminary service, demand, finance and benefit-cost model for each alternative.

Everything here is a screening estimate. Inputs live in data/service_parameters.json with their
sources; demand is calibrated to FY2024 Amtrak station ridership (data/observed_rail.json,
scripts/calibrate_demand.py). Uncertain inputs are sampled in a Monte Carlo and reported as
P10/P50/P90.

Running time   integrate 1 / (top speed x efficiency) over the route's track profile (upgraded
               existing rail vs new track, with a cap on mountainous sections), plus a penalty per
               intermediate stop and per large-terminal approach. Every train stops everywhere.
Door to door   rail: train time + access/egress + a quarter of the headway (schedule delay);
               car: straight-line miles x circuity at an average speed + parking; air: fixed
               airport time + block time (only for pairs 300+ straight-line miles apart). Demand
               compares rail with the faster of car and air.
Demand         annual trips between stations i and j (both directions):
                   R_ij = s x (P_i P_j / 1e12)^a x F^f x (rail door-to-door / car time)^-g x (D_ij / 100)^-d
               P = residents within 10 km of the station (2020 Census grid), F = daily round trips,
               D = straight-line miles. a and f are assumptions; s, g and d are fitted to FY2024 station
               ridership, and the leave-one-out fit error sets the demand uncertainty band.
Capacity       ridership is capped at an average load factor of 75% of the seats offered.
Finance        operating cost = train-miles x cost per train-mile; revenue = passenger-miles x fare
               per passenger-mile (both from Amtrak's FY2024 route results); subsidy = cost - revenue.
Fleet          trainsets to cover the round-trip cycle at the headway, plus spares.
Benefit-cost   USDOT 2026 guidance values. Benefits: rule-of-half user benefit from lower
               generalized cost than driving, fare revenue (offsets the fare inside user cost),
               and fatal crashes avoided on diverted car miles. Costs: capital (from the cost
               simulation), trainsets, operations and renewals. 7% discount rate, 30 years of
               operation; 3.1% shown as a sensitivity. CO2 is reported in tonnes, not monetized.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

import numpy as np
from pydantic import BaseModel

from .config import DATA_DIR
from .models import RouteResult, ServicePair, ServiceRange, ServiceResult
from .routing import load_cities, load_grid
from .scoring import STATION_CATCHMENT_KM, _disk

TERMINALS = {"New York City", "Philadelphia", "Chicago"}
PUBLIC_OWNERS = {"AMTK", "MNCW", "NJT", "SEPA", "LI", "LIRR", "MBTA", "MARC", "NICD", "NIRC", "PATH", "SIR"}
DRAWS = 2000
AIR_MIN_MILES = 300


@lru_cache
def load_parameters() -> dict:
    return json.loads((DATA_DIR / "service_parameters.json").read_text(encoding="utf-8"))


def P(name: str):
    return load_parameters()["params"][name]["value"]


def _range(name: str) -> tuple[float, float, float]:
    p = load_parameters()["params"][name]
    return p.get("low", p["value"]), p["value"], p.get("high", p["value"])


class ServiceParams(BaseModel):
    """The user-editable part of the service plan."""
    round_trips: int = 8
    max_mph_existing: float = 90
    max_mph_new: float = 125


# ---------------------------------------------------------------- geography

def _gc_miles(a: dict, b: dict) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


@lru_cache
def city_index() -> dict[str, dict]:
    return {c["name"]: c for c in load_cities()}


@lru_cache
def catchments() -> dict[str, float]:
    """Residents within STATION_CATCHMENT_KM of each city's station point (2020 Census grid)."""
    g = load_grid()
    rad = int(round(STATION_CATCHMENT_KM * 1000 / g.cell))
    disk = _disk(rad)
    out = {}
    for c in load_cities():
        r, col = g.rc(c["lon"], c["lat"])
        r0, r1 = max(r - rad, 0), min(r + rad + 1, g.shape[0])
        c0, c1 = max(col - rad, 0), min(col + rad + 1, g.shape[1])
        window = g.layers["pop"][r0:r1, c0:c1]
        mask = disk[(r0 - r + rad):(r1 - r + rad), (c0 - col + rad):(c1 - col + rad)]
        out[c["name"]] = float(window[mask].sum())
    return out


def car_minutes(gc: float, circuity=None, mph=None):
    circuity = P("car_circuity") if circuity is None else circuity
    mph = P("car_mph") if mph is None else mph
    return gc * circuity / mph * 60 + P("car_fixed_min")


def air_minutes(gc: float) -> float | None:
    return P("air_fixed_min") + gc / P("air_block_mph") * 60 if gc >= AIR_MIN_MILES else None


def competitor_minutes(gc, car):
    """The faster of driving and flying (flying only for pairs 300+ straight-line miles apart)."""
    gc = np.asarray(gc, dtype=float)
    air = np.where(gc >= AIR_MIN_MILES, P("air_fixed_min") + gc / P("air_block_mph") * 60, np.inf)
    return np.minimum(car, air)


# ---------------------------------------------------------------- demand

def demand(pop_i, pop_j, freq, rail_door_min, car_min, miles, scale, gamma, decay, freq_el=None):
    a = P("pop_exponent")
    f = P("freq_elasticity") if freq_el is None else freq_el
    return (scale * (pop_i * pop_j / 1e12) ** a * np.power(freq, f) * np.power(rail_door_min / car_min, -gamma)
            * np.power(np.asarray(miles) / 100, -decay))


def schedule_delay(freq: float) -> float:
    """A quarter of the headway: the average wait to the next convenient departure."""
    return P("span_hours") * 60 / max(freq, 1) / 4


@lru_cache
def observed() -> dict:
    return json.loads((DATA_DIR / "observed_rail.json").read_text(encoding="utf-8"))


def observed_pairs() -> list[dict]:
    """City pairs with direct FY2024 service: combined frequency and fastest scheduled time."""
    pairs: dict[tuple[str, str], dict] = {}
    for s in observed()["services"]:
        stops = s["stops"]
        for i in range(len(stops)):
            for j in range(i + 1, len(stops)):
                a, b = sorted((stops[i][0], stops[j][0]))
                t = stops[j][1] - stops[i][1]
                p = pairs.setdefault((a, b), {"a": a, "b": b, "freq": 0, "train_min": t})
                p["freq"] += s["round_trips"]
                p["train_min"] = min(p["train_min"], t)
    return list(pairs.values())


def calibrate() -> dict:
    """Fit the demand scale, time-ratio exponent and distance decay to FY2024 station ridership
    (least squares in logs over a grid), and report in-sample and leave-one-out errors."""
    cities, pop = city_index(), catchments()
    obs = observed()["station_ridership"]
    base = []
    for p in observed_pairs():
        gc = _gc_miles(cities[p["a"]], cities[p["b"]])
        door = p["train_min"] + P("access_egress_min") + schedule_delay(p["freq"])
        car = float(competitor_minutes(gc, car_minutes(gc)))
        base.append((p["a"], p["b"], float(demand(pop[p["a"]], pop[p["b"]], p["freq"], door, car, gc, 1.0, 0.0, 0.0)),
                     door / car, gc / 100))
    names = list(obs)

    def volumes(gamma, decay, keep):
        v = dict.fromkeys(keep, 0.0)
        for a, b, x, ratio, d in base:
            r = x * ratio ** -gamma * d ** -decay
            if a in v:
                v[a] += r
            if b in v:
                v[b] += r
        return np.log([v[n] for n in keep])

    grid = [(g, d) for g in np.arange(0.0, 4.01, 0.1) for d in np.arange(0.0, 3.01, 0.1)]

    def fit(keep):
        y = np.log([obs[n] for n in keep])
        best = None
        for g, d in grid:
            lp = volumes(g, d, keep)
            logk = float(np.mean(y - lp))
            err = float(np.sqrt(np.mean((y - lp - logk) ** 2)))
            if best is None or err < best[3]:
                best = (float(g), float(d), logk, err)
        return best

    gamma, decay, logk, err = fit(names)
    # Leave-one-out: refit without each station, then predict it.
    loo = []
    for n in names:
        g, d, lk, _ = fit([m for m in names if m != n])
        loo.append(float(volumes(g, d, [n])[0] + lk - math.log(obs[n])))
    pred = np.exp(volumes(gamma, decay, names) + logk)
    return {
        "scale": math.exp(logk),
        "time_ratio_exponent": round(gamma, 2),
        "distance_decay": round(decay, 2),
        "rms_log_error": round(err, 3),
        "loo_rms_log_error": round(float(np.sqrt(np.mean(np.square(loo)))), 3),
        "stations": [{"name": n, "observed": int(obs[n]), "modeled": int(round(p)), "ratio": round(float(p / obs[n]), 2)}
                     for n, p in zip(names, pred)],
        "pairs_used": len(base),
        "note": ("Fitted to FY2024 Amtrak boardings plus alightings at 12 stations; New York, Philadelphia and "
                 "Chicago are excluded because most of their riders use other services. Known misses: Albany and "
                 "Pittsburgh also have trains to places outside this network; Lake Shore Limited stations west of "
                 "Buffalo are served overnight, which the model does not represent."),
    }


@lru_cache
def calibration() -> dict:
    path = DATA_DIR / "demand_calibration.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return calibrate()


# ---------------------------------------------------------------- running time

def _speed(treatment: str, terrain: str, sp: ServiceParams) -> float:
    top = sp.max_mph_new if treatment == "new" else sp.max_mph_existing
    if terrain == "mountainous":
        top = min(top, P("max_mph_mountain"))
    return top * P("speed_efficiency")


def _minutes_to(mile: float, profile: list[list], sp: ServiceParams) -> float:
    t = 0.0
    for s, e, treatment, terrain in profile:
        if s >= mile:
            break
        t += (min(e, mile) - s) / _speed(treatment, terrain, sp) * 60
    return t


def train_times(route: RouteResult, sp: ServiceParams) -> tuple[list[str], list[float], list[float]]:
    """Station names, route miles and cumulative running minutes (without stop penalties)."""
    st = route.stats.station_miles
    names = [s["name"] for s in st]
    miles = [float(s["mile"]) for s in st]
    profile = route.stats.track_profile or [[0.0, route.stats.length_miles, "upgrade", "flat"]]
    return names, miles, [_minutes_to(m, profile, sp) for m in miles]


def pair_train_minutes(i: int, j: int, names: list[str], run: list[float]) -> float:
    t = run[j] - run[i] + P("stop_penalty_min") * (j - i - 1)
    t += P("terminal_penalty_min") * ((names[i] in TERMINALS) + (names[j] in TERMINALS))
    return t


# ---------------------------------------------------------------- host railroads

@lru_cache
def _rail_index():
    import shapely
    from shapely.geometry import shape

    data = json.loads((DATA_DIR / "processed" / "layers" / "rail.geojson").read_text(encoding="utf-8"))
    geoms, props = [], []
    for f in data["features"]:
        if f.get("geometry"):
            geoms.append(shape(f["geometry"]))
            props.append(f["properties"])
    return shapely.STRtree(geoms), geoms, props


def host_shares(route: RouteResult) -> dict:
    """Share of route miles near existing rail by owner type, and single-track share where known."""
    import shapely
    from shapely.geometry import LineString

    tree, geoms, props = _rail_index()
    line = LineString(route.geometry["coordinates"])
    n = max(int(route.stats.length_miles), 2)
    pts = [line.interpolate(k / (n - 1), normalized=True) for k in range(n)]
    counts = {"public": 0, "freight": 0, "inactive": 0, "none": 0}
    single = known = 0
    for pt in pts:
        idx = tree.query(pt.buffer(0.012))  # about 1 km
        best, bd = None, 1.0
        for i in idx:
            d = geoms[i].distance(pt)
            if d < bd:
                best, bd = i, d
        if best is None or bd > 0.012:
            counts["none"] += 1
            continue
        pr = props[best]
        if pr.get("status") != "active":
            counts["inactive"] += 1
            continue
        counts["public" if pr.get("owner") in PUBLIC_OWNERS else "freight"] += 1
        tracks = int(pr.get("tracks") or 0)
        if tracks > 0:
            known += 1
            single += tracks == 1
    total = sum(counts.values())
    return {
        "public_share": counts["public"] / total,
        "freight_share": counts["freight"] / total,
        "inactive_share": counts["inactive"] / total,
        "off_rail_share": counts["none"] / total,
        "single_track_share": (single / known) if known else None,
        "track_count_known_share": known / max(counts["public"] + counts["freight"], 1),
    }


# ---------------------------------------------------------------- evaluation

def _lognormal(rng, p10: float, p50: float, p90: float, n: int) -> np.ndarray:
    sigma = max((math.log(p90) - math.log(p10)) / (2 * 1.2816), 1e-6)
    return np.exp(rng.normal(math.log(p50), sigma, n))


def _pert(rng, lo: float, mode: float, hi: float, n: int) -> np.ndarray:
    if hi <= lo:
        return np.full(n, mode)
    a = 1 + 4 * (mode - lo) / (hi - lo)
    b = 1 + 4 * (hi - mode) / (hi - lo)
    return lo + rng.beta(a, b, n) * (hi - lo)


def _pct(x: np.ndarray) -> ServiceRange:
    p10, p50, p90 = np.percentile(x, [10, 50, 90])
    return ServiceRange(p10=float(p10), p50=float(p50), p90=float(p90))


def _pv_factors(years_to_open: np.ndarray, rate: float, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Discount factors for operating years 1..horizon after opening, per draw; plus ramp weights."""
    t = years_to_open[:, None] + np.arange(1, horizon + 1)[None, :]
    disc = (1 + rate) ** -t
    ramp = np.ones(horizon)
    for k, v in enumerate(P("ramp_up")):
        if k < horizon:
            ramp[k] = v
    return disc, ramp


def evaluate(route: RouteResult, sp: ServiceParams | None = None, seed: int = 7) -> ServiceResult:
    sp = sp or ServiceParams()
    rng = np.random.default_rng(seed)
    cal = calibration()
    cities, pop = city_index(), catchments()
    names, miles, run = train_times(route, sp)
    freq = max(sp.round_trips, 1)
    headway = P("span_hours") * 60 / freq
    delay = schedule_delay(freq)

    # Station pairs on this alignment (central case)
    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = cities[names[i]], cities[names[j]]
            gc = _gc_miles(a, b)
            train = pair_train_minutes(i, j, names, run)
            door = train + P("access_egress_min") + delay
            car = car_minutes(gc)
            pairs.append({"a": names[i], "b": names[j], "i": i, "j": j, "gc": gc, "rail_miles": miles[j] - miles[i],
                          "train": train, "door": door, "car": car, "air": air_minutes(gc),
                          "pa": pop[names[i]], "pb": pop[names[j]]})
    if not pairs:
        return ServiceResult(available=False, note="Fewer than two stations on this alignment, so no service can be estimated.")

    gamma, decay = cal["time_ratio_exponent"], cal["distance_decay"]
    k = len(pairs)
    pa = np.array([p["pa"] for p in pairs]); pb = np.array([p["pb"] for p in pairs])
    gcm = np.array([p["gc"] for p in pairs]); rmi = np.array([p["rail_miles"] for p in pairs])
    train = np.array([p["train"] for p in pairs])
    stops_between = np.array([p["j"] - p["i"] - 1 for p in pairs])

    # ---- draws of uncertain inputs (shape DRAWS x 1 so they broadcast over pairs)
    n = DRAWS
    eff_lo, eff_mid, eff_hi = _range("speed_efficiency")
    eff = _pert(rng, eff_lo, eff_mid, eff_hi, n)[:, None]
    stop = _pert(rng, *_range("stop_penalty_min"), n)[:, None]
    access = _pert(rng, *_range("access_egress_min"), n)[:, None]
    circ = _pert(rng, *_range("car_circuity"), n)[:, None]
    cmph = _pert(rng, *_range("car_mph"), n)[:, None]
    f_el = _pert(rng, *_range("freq_elasticity"), n)[:, None]
    fare = _pert(rng, *_range("fare_per_pmi"), n)
    cptm = _pert(rng, *_range("cost_per_train_mile"), n)
    tset = _pert(rng, *_range("trainset_cost"), n)
    renew = _pert(rng, *_range("renewal_share"), n)
    divert = _pert(rng, *_range("car_diversion_share"), n)[:, None]
    noise = np.exp(rng.normal(0, cal["loo_rms_log_error"], n))[:, None]

    # train time: running part scales with 1/efficiency; stop penalties resampled
    running = train - P("stop_penalty_min") * stops_between
    train_d = running[None, :] * (eff_mid / eff) + (stop - P("stop_penalty_min")) * stops_between[None, :]
    door_d = train_d + access + delay
    car_d = gcm[None, :] * circ / cmph * 60 + P("car_fixed_min")
    rival_d = competitor_minutes(gcm[None, :], car_d)
    trips = demand(pa[None, :], pb[None, :], freq, door_d, rival_d, gcm[None, :], cal["scale"], gamma, decay, f_el) * noise

    end_to_end = pair_train_minutes(0, len(names) - 1, names, run)
    route_miles = miles[-1] - miles[0]
    train_miles = freq * 2 * route_miles * 365
    seats = P("seats_per_train")
    # Capacity: the service plan cannot carry more than the maximum average load.
    pmi_raw = (trips * rmi[None, :]).sum(1)
    cap = P("max_load_factor") * seats * train_miles
    limited = pmi_raw > cap
    trips = trips * np.minimum(1.0, cap / np.maximum(pmi_raw, 1))[:, None]
    riders = trips.sum(1)
    pmi = (trips * rmi[None, :]).sum(1)
    revenue = pmi * fare
    opex = train_miles * cptm
    subsidy = opex - revenue

    cycle = 2 * (end_to_end + P("turnaround_min"))
    in_service = math.ceil(cycle / headway)
    trainsets = in_service + max(1, math.ceil(P("spare_ratio") * in_service))
    fleet_cost = trainsets * tset

    # ---- benefit-cost
    vtts, voc, occ = P("vtts_intercity_personal"), P("voc_per_mile"), P("car_occupancy")
    road = gcm[None, :] * circ
    gc_car = car_d / 60 * vtts + road * voc / occ
    gc_rail = door_d / 60 * vtts + fare[:, None] * rmi[None, :]
    user = 0.5 * (trips * np.maximum(gc_car - gc_rail, 0)).sum(1)
    vmt = (trips * divert * road / occ).sum(1)
    fatalities = vmt * P("fatality_rate")
    safety = fatalities * P("fatal_crash_value")
    train_co2 = P("cars_per_train") * P("rail_btu_per_car_mile") / P("diesel_btu_per_gal") * P("diesel_co2_g_per_gal")
    co2 = (vmt * P("car_co2_g_per_mile") - train_miles * train_co2) / 1e6  # tonnes per year

    c = route.simulation.cost
    d = route.simulation.duration
    capital = _lognormal(rng, c.p10, c.p50, c.p90, n)
    years = _lognormal(rng, d.p10, d.p50, d.p90, n) / 12
    horizon = P("analysis_years")

    def bca(rate: float):
        disc, ramp = _pv_factors(years, rate, horizon)
        build = np.maximum(np.round(years * 0.6), 1)  # capital spent evenly over the last 60% of delivery
        cap_pv = np.zeros(n)
        for b in np.unique(build):
            m = build == b
            t = years[m][:, None] - np.arange(int(b))[None, :]
            cap_pv[m] = (capital[m][:, None] / b * (1 + rate) ** -np.maximum(t, 0)).sum(1)
        fleet_pv = fleet_cost * (1 + rate) ** -np.maximum(years - 1, 0)
        ops_pv = ((opex + renew * capital)[:, None] * disc).sum(1)
        ben_pv = ((user + revenue + safety)[:, None] * ramp[None, :] * disc).sum(1)
        cost_pv = cap_pv + fleet_pv + ops_pv
        return ben_pv / cost_pv, ben_pv - cost_pv, ben_pv, cost_pv

    bcr7, npv7, ben7, cost7 = bca(P("discount_rate"))
    bcr3, npv3, _, _ = bca(P("discount_rate_alt"))

    car_c = np.array([p["car"] for p in pairs])
    central = demand(pa, pb, freq, train + P("access_egress_min") + delay, competitor_minutes(gcm, car_c), gcm,
                     cal["scale"], gamma, decay)
    pmi_c = float((central * rmi).sum())
    central = central * min(1.0, P("max_load_factor") * seats * train_miles / max(pmi_c, 1))
    out_pairs = [ServicePair(a=p["a"], b=p["b"], straight_miles=round(p["gc"], 1), rail_miles=round(p["rail_miles"], 1),
                             train_min=round(p["train"], 1), rail_door_min=round(p["door"], 1),
                             car_min=round(p["car"], 1), air_min=None if p["air"] is None else round(p["air"], 1),
                             trips=round(float(central[q])))
                 for q, p in enumerate(pairs)]
    faster = sum(p.rail_door_min <= p.car_min for p in out_pairs)

    return ServiceResult(
        available=True,
        round_trips=freq, max_mph_existing=sp.max_mph_existing, max_mph_new=sp.max_mph_new,
        headway_min=round(headway), stations=len(names),
        end_to_end_min=round(end_to_end, 1),
        avg_speed_mph=round(route_miles / (end_to_end / 60), 1) if end_to_end > 0 else 0.0,
        end_to_end_car_min=round(next(p.car_min for p in out_pairs if p.a == names[0] and p.b == names[-1]), 1),
        pairs=out_pairs,
        share_pairs_faster_than_car=faster / len(out_pairs),
        riders=_pct(riders), passenger_miles=_pct(pmi), revenue=_pct(revenue), opex=_pct(opex), subsidy=_pct(subsidy),
        load_factor=float(np.median(pmi) / (train_miles * seats)),
        capacity_limited_share=float(limited.mean()),
        train_miles=train_miles, trainsets=trainsets, fleet_cost=_pct(fleet_cost),
        bcr=_pct(bcr7), npv=_pct(npv7), pv_benefits=_pct(ben7), pv_costs=_pct(cost7),
        bcr_alt=_pct(bcr3), npv_alt=_pct(npv3),
        user_benefit=_pct(user), safety_benefit=_pct(safety),
        co2_tonnes=_pct(co2), fatalities_avoided=_pct(fatalities), car_vmt_avoided=_pct(vmt),
        **host_shares(route),
        calibration_error=cal["loo_rms_log_error"],
    )
