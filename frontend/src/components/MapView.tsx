import { Fragment, useEffect, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import type { City, PlanResult } from "../api";
import { altStyle, miles } from "../format";
import P5Overlay from "./P5Overlay";

export type Basemap = "light" | "satellite";
export interface Layers {
  rail: boolean;
  protected: boolean;
  terrain: boolean;
  labels: boolean;
}
export interface FitRequest {
  kind: "all" | "selected";
  n: number;
}

interface Props {
  cities: City[];
  plan: PlanResult | null;
  originId: number | null;
  destId: number | null;
  selected: number;
  leader: number | null;
  pickMode: boolean;
  animate: boolean;
  replayKey: number;
  basemap: Basemap;
  layers: Layers;
  fit: FitRequest;
  onCityPick: (id: number) => void;
  onRouteClick: (idx: number) => void;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const toLatLng = (coords: [number, number][]) => coords.map(([lon, lat]) => [lat, lon] as [number, number]);

function Fitter({ plan, cities, selected, fit }: { plan: PlanResult | null; cities: City[]; selected: number; fit: FitRequest }) {
  const map = useMap();
  useEffect(() => {
    const pts =
      plan && fit.kind === "selected" && plan.routes[selected]
        ? toLatLng(plan.routes[selected].geometry.coordinates)
        : plan
          ? plan.routes.flatMap((r) => toLatLng(r.geometry.coordinates))
          : cities.map((c) => [c.lat, c.lon] as [number, number]);
    if (!pts.length) return;
    const doFit = () => {
      const s = map.getSize();
      if (s.x < 50 || s.y < 50) return; // not laid out yet
      map.fitBounds(L.latLngBounds(pts), { padding: [36, 36] });
    };
    doFit();
    map.on("resize", doFit);
    return () => {
      map.off("resize", doFit);
    };
    // re-fit when a new plan arrives or a fit is requested, not on every selection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, cities, fit.n, map]);
  return null;
}

function useLayer(name: string, on: boolean) {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    if (!on || data) return;
    fetch(`/api/layers/${name}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [on, data, name]);
  return on ? data : null;
}

function badge(rank: number, color: string, selected: boolean) {
  return L.divIcon({
    className: "route-badge-wrap",
    html: `<span class="route-badge${selected ? " sel" : ""}" style="--c:${color}">${rank}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function endpoint(letter: string) {
  return L.divIcon({
    className: "route-badge-wrap",
    html: `<span class="endpoint">${letter}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function stationIcon(n: number) {
  return L.divIcon({
    className: "route-badge-wrap",
    html: `<span class="station">${n}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export default function MapView(p: Props) {
  const rail = useLayer("rail", p.layers.rail);
  const protectedAreas = useLayer("protected", p.layers.protected);
  const route = p.plan?.routes[p.selected];
  const byName = new Map(p.cities.map((c) => [c.name, c]));
  const order = p.plan
    ? p.plan.routes.map((_, i) => i).sort((a, b) => (a === p.selected ? 1 : b === p.selected ? -1 : a - b))
    : [];

  return (
    <MapContainer className="map" center={[41.6, -79.5]} zoom={6} minZoom={4} scrollWheelZoom={false} zoomControl={false}>
      <ZoomControl position="topright" />
      {p.basemap === "satellite" ? (
        <TileLayer
          key="sat"
          attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
          url={`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`}
          maxZoom={17}
        />
      ) : (
        <TileLayer
          key="light"
          attribution="Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          url={`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`}
          maxZoom={16}
        />
      )}
      {p.layers.terrain && (
        <TileLayer url={`${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`} opacity={0.35} maxZoom={16} />
      )}
      {p.layers.labels && (
        <TileLayer
          key={`labels-${p.basemap}`}
          url={
            p.basemap === "satellite"
              ? `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`
              : `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
          }
          maxZoom={16}
          opacity={0.9}
        />
      )}
      {protectedAreas && (
        <GeoJSON
          key="protected"
          data={protectedAreas}
          style={(f) => ({
            color: f?.properties?.refuge ? "#1d7a6a" : "#3f7d3a",
            weight: 0.6,
            fillOpacity: 0.18,
            opacity: 0.6,
          })}
          onEachFeature={(f, layer) =>
            layer.bindTooltip(
              `${f.properties.name}${f.properties.refuge ? " (wildlife refuge)" : ""} · PAD-US GAP 1–2`,
              { sticky: true },
            )
          }
        />
      )}
      {rail && (
        <GeoJSON
          key="rail"
          data={rail}
          style={(f) => ({
            color: f?.properties?.status === "inactive" ? "#9aa1ab" : "#55606e",
            weight: f?.properties?.tracks > 1 ? 1.6 : 1,
            opacity: 0.7,
            dashArray: f?.properties?.status === "inactive" ? "3 4" : undefined,
          })}
          onEachFeature={(f, layer) => {
            const pr = f.properties;
            layer.bindTooltip(
              `Existing rail · owner ${pr.owner}${pr.status === "inactive" ? " · inactive" : ""}` +
                `${pr.tracks ? ` · ${pr.tracks} track${pr.tracks > 1 ? "s" : ""}` : ""}` +
                `${pr.passenger ? ` · passenger: ${pr.passenger}` : ""}<br/><em>Ownership is not access or capacity.</em>`,
              { sticky: true },
            );
          }}
        />
      )}

      <Fitter plan={p.plan} cities={p.cities} selected={p.selected} fit={p.fit} />
      <P5Overlay plan={p.plan} cities={p.cities} selected={p.selected} enabled={p.animate} replayKey={p.replayKey} />

      {order.map((i) => {
        const r = p.plan!.routes[i];
        const pts = toLatLng(r.geometry.coordinates);
        const st = altStyle(i);
        const sel = i === p.selected;
        const building = sel && p.animate;
        return (
          <Fragment key={r.key}>
            <Polyline positions={pts} pathOptions={{ color: "#ffffff", weight: sel ? 9 : 5, opacity: sel ? 0.95 : 0.7 }} interactive={false} />
            <Polyline
              positions={pts}
              pathOptions={{
                color: st.color,
                weight: sel ? 5 : 3,
                opacity: building ? 0.25 : sel ? 1 : 0.6,
                dashArray: st.dash,
                lineCap: st.pattern === "dotted" ? "round" : "butt",
              }}
              eventHandlers={{ click: () => p.onRouteClick(i) }}
            >
              <Tooltip sticky>
                {r.rank}. {r.label} · {miles(r.stats.length_miles)}
                {i === p.leader ? " · leads under current priorities" : ""}
              </Tooltip>
            </Polyline>
            <Marker
              position={pts[Math.floor(pts.length * (0.35 + 0.15 * i))]}
              icon={badge(r.rank, st.color, sel)}
              zIndexOffset={sel ? 900 : 0}
              eventHandlers={{ click: () => p.onRouteClick(i) }}
              title={`Alternative ${r.rank}: ${r.label}`}
            />
          </Fragment>
        );
      })}

      {route?.stats.station_miles.map((s, k) => {
        const c = byName.get(s.name);
        if (!c || c.id === p.originId || c.id === p.destId) return null;
        return (
          <Marker key={`st-${s.name}`} position={[c.lat, c.lon]} icon={stationIcon(k + 1)} zIndexOffset={800}>
            <Tooltip direction="top" offset={[0, -8]}>
              Station {k + 1}: {s.name} · mile {Math.round(s.mile)}
            </Tooltip>
          </Marker>
        );
      })}

      {p.cities.map((c) => {
        if (c.id === p.originId || c.id === p.destId) return null;
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lon]}
            radius={p.pickMode ? 7 : 4}
            pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: p.pickMode ? "#1f2937" : "#6b7280", fillOpacity: 1 }}
            eventHandlers={{ click: () => p.pickMode && p.onCityPick(c.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {p.pickMode ? "Choose " : ""}
              {c.name}, {c.state}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {[
        [p.originId, "A"],
        [p.destId, "B"],
      ].map(([id, letter]) => {
        const c = p.cities.find((x) => x.id === id);
        if (!c) return null;
        return (
          <Marker key={`end-${letter}`} position={[c.lat, c.lon]} icon={endpoint(letter as string)} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -12]} permanent>
              {letter === "A" ? "From" : "To"}: {c.name}
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
