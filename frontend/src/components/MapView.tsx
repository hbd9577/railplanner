import { Fragment, useEffect } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from "react-leaflet";
import type { City, PlanResult } from "../api";
import { PALETTE } from "../format";
import P5Overlay from "./P5Overlay";

interface Props {
  cities: City[];
  plan: PlanResult | null;
  originId: number | null;
  destId: number | null;
  selected: number;
  animate: boolean;
  replayKey: number;
  onCityClick: (id: number) => void;
  onRouteClick: (idx: number) => void;
}

const toLatLng = (coords: [number, number][]) => coords.map(([lon, lat]) => [lat, lon] as [number, number]);
const CASING = "#2b2118"; // dark brown edge keeps lines legible over imagery
const OVERLAY_WIDTH = 440; // matches .hero-panel width in styles.css
const HEADER_HEIGHT = 120; // floating .masthead over the map

function FitToPlan({ plan, cities }: { plan: PlanResult | null; cities: City[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = plan
      ? plan.routes.flatMap((r) => toLatLng(r.geometry.coordinates))
      : cities.map((c) => [c.lat, c.lon] as [number, number]);
    // On wide screens the control panel overlays the map's left edge, so keep routes to its right.
    const wide = map.getContainer().clientWidth >= 860;
    // the floating header covers the top of the map, so leave room under it
    const pad = wide
      ? { paddingTopLeft: [OVERLAY_WIDTH + 40, HEADER_HEIGHT + 20], paddingBottomRight: [70, 50] }
      : { paddingTopLeft: [16, 150], paddingBottomRight: [16, 30] };
    if (pts.length) map.fitBounds(L.latLngBounds(pts), pad as L.FitBoundsOptions);
  }, [plan, cities, map]);
  return null;
}

// Numbered badge at the middle of each route: identity comes from the number, not color.
function routeBadge(rank: number, active: boolean) {
  const style = `background:${active ? PALETTE.yellow : PALETTE.mapGrey};color:${CASING}`;
  return L.divIcon({
    className: "route-badge-wrap",
    html: `<span class="route-badge${active ? " active" : ""}" style="${style}">${rank}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function MapView(props: Props) {
  const { cities, plan, originId, destId, selected, animate, replayKey, onCityClick, onRouteClick } = props;
  // Draw inactive corridors first so the active one sits on top.
  const order = plan ? plan.routes.map((_, i) => i).sort((a, b) => (a === selected ? 1 : b === selected ? -1 : a - b)) : [];

  return (
    <MapContainer className="map" center={[41.8, -79.5]} zoom={6} minZoom={4} scrollWheelZoom={false} zoomControl={false}>
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS user community"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={17}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={17}
        opacity={0.8}
      />
      <FitToPlan plan={plan} cities={cities} />
      <P5Overlay plan={plan} cities={cities} selected={selected} enabled={animate} replayKey={replayKey} />

      {order.map((i) => {
        const r = plan!.routes[i];
        const pts = toLatLng(r.geometry.coordinates);
        const active = i === selected;
        // While the construction animation runs, the active corridor is only a dashed survey line;
        // the p5 canvas draws the track as it is "built".
        const surveyOnly = active && animate;
        return (
          <Fragment key={r.key}>
            <Polyline
              positions={pts}
              pathOptions={{ color: CASING, weight: active ? 8 : 5, opacity: surveyOnly ? 0.35 : 0.75 }}
              interactive={false}
            />
            <Polyline
              positions={pts}
              pathOptions={
                surveyOnly
                  ? { color: PALETTE.tan, weight: 2, opacity: 0.95, dashArray: "6 8" }
                  : { color: active ? PALETTE.yellow : PALETTE.mapGrey, weight: active ? 5 : 3, opacity: active ? 1 : 0.9 }
              }
              eventHandlers={{ click: () => onRouteClick(i) }}
            >
              <Tooltip sticky>
                {r.rank}. {r.label} &middot; {r.stats.length_miles.toFixed(0)} mi
              </Tooltip>
            </Polyline>
            <Marker
              position={pts[Math.floor(pts.length / 2)]}
              icon={routeBadge(r.rank, active)}
              eventHandlers={{ click: () => onRouteClick(i) }}
              zIndexOffset={active ? 1000 : 0}
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
              color: CASING,
              weight: 2,
              fillColor: role ? PALETTE.yellow : "#ffffff",
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
