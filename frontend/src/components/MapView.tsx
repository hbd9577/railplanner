import { Fragment, useEffect } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { City, PlanResult } from "../api";
import { ROUTE_COLORS } from "../format";
import P5Overlay from "./P5Overlay";

interface Props {
  cities: City[];
  plan: PlanResult | null;
  originId: number | null;
  destId: number | null;
  selected: number;
  animate: boolean;
  onCityClick: (id: number) => void;
  onRouteClick: (idx: number) => void;
}

const toLatLng = (coords: [number, number][]) => coords.map(([lon, lat]) => [lat, lon] as [number, number]);

function FitToPlan({ plan, cities }: { plan: PlanResult | null; cities: City[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = plan
      ? plan.routes.flatMap((r) => toLatLng(r.geometry.coordinates))
      : cities.map((c) => [c.lat, c.lon] as [number, number]);
    // keep routes clear of the legend panel in the top-right corner
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [30, 140], paddingBottomRight: [30, 30] });
  }, [plan, cities, map]);
  return null;
}

// Numbered badge at the middle of each route: identity is never color-alone.
function routeBadge(rank: number, color: string) {
  return L.divIcon({
    className: "route-badge-wrap",
    html: `<span class="route-badge" style="background:${color}">${rank}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function MapView({ cities, plan, originId, destId, selected, animate, onCityClick, onRouteClick }: Props) {
  return (
    <MapContainer className="map" center={[41.8, -79.5]} zoom={6} minZoom={4} scrollWheelZoom={false}>
      <TileLayer
        attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />
      <FitToPlan plan={plan} cities={cities} />
      <P5Overlay plan={plan} cities={cities} selected={selected} enabled={animate} />

      {plan?.routes.map((r, i) => {
        const pts = toLatLng(r.geometry.coordinates);
        const active = i === selected;
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        return (
          <Fragment key={r.key}>
            {/* white casing = 2px surface ring where routes overlap */}
            <Polyline positions={pts} pathOptions={{ color: "#fff", weight: active ? 9 : 6, opacity: 0.9 }} />
            <Polyline
              positions={pts}
              pathOptions={{ color, weight: active ? 5 : 3, opacity: active ? 1 : 0.55 }}
              eventHandlers={{ click: () => onRouteClick(i) }}
            >
              <Tooltip sticky>
                {r.rank}. {r.label} &middot; {r.stats.length_miles.toFixed(0)} mi
              </Tooltip>
            </Polyline>
            <Marker
              position={pts[Math.floor(pts.length / 2)]}
              icon={routeBadge(r.rank, color)}
              eventHandlers={{ click: () => onRouteClick(i) }}
            />
          </Fragment>
        );
      })}

      {cities.map((c) => {
        const role = c.id === originId ? "origin" : c.id === destId ? "dest" : null;
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lon]}
            radius={role ? 8 : 5}
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: role ? "#0b0b0b" : "#52514e",
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onCityClick(c.id) }}
          >
            <Tooltip key={role ?? "none"} direction="top" offset={[0, -6]} permanent={!!role} className={role ? "city-tip-strong" : ""}>
              {role === "origin" ? "From: " : role === "dest" ? "To: " : ""}
              {c.name}, {c.state}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
