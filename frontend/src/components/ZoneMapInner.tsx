// frontend/src/components/ZoneMapInner.tsx
// Actual Leaflet map. Only ever loaded client-side via next/dynamic in
// ZoneMap.tsx (ssr: false) — Leaflet touches `window` at import time.

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AnalysisResult, Zone } from "@/lib/api";

interface Props {
  analysis: AnalysisResult;
  postImageUrl?: string;
}

type GeoZone = Zone & { centroid_lat: number; centroid_lng: number };

function rankColor(rank: number) {
  if (rank === 1) return "#ef4444";
  if (rank === 2) return "#f97316";
  if (rank === 3) return "#eab308";
  return "#22c55e";
}

function FitImageBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [12, 12] });
  }, [map, bounds]);
  return null;
}

function zoneMarkers(geoZones: GeoZone[], imageMode: boolean) {
  return geoZones.map((zone) => {
    // Image mode stores pixel (x,y) as (lng, lat) = (x, y).
    const center: [number, number] = imageMode
      ? [zone.centroid_lat, zone.centroid_lng]
      : [zone.centroid_lat, zone.centroid_lng];

    return (
      <CircleMarker
        key={zone.rank}
        center={center}
        radius={zone.rank <= 3 ? 12 : 8}
        pathOptions={{
          color: rankColor(zone.rank),
          fillColor: rankColor(zone.rank),
          fillOpacity: 0.55,
          weight: 2,
        }}
      >
        <Popup>
          <div className="text-xs">
            <p className="font-bold">Zone {zone.rank}</p>
            <p>
              Destroyed: {zone.building_counts.destroyed} · Major:{" "}
              {zone.building_counts.major} buildings
            </p>
            <p>Priority score: {zone.priority_score}</p>
            {imageMode ? (
              <p>
                Pixel: ({Math.round(zone.centroid_lng)},{" "}
                {Math.round(zone.centroid_lat)})
              </p>
            ) : (
              <p>
                {zone.centroid_lat.toFixed(5)}, {zone.centroid_lng.toFixed(5)}
              </p>
            )}
          </div>
        </Popup>
      </CircleMarker>
    );
  });
}

export default function ZoneMapInner({ analysis, postImageUrl }: Props) {
  const imageMode = analysis.geo_mode === "image" || !analysis.geo_available;
  const [naturalSize, setNaturalSize] = useState<[number, number] | null>(
    analysis.image_size
      ? [analysis.image_size[0], analysis.image_size[1]]
      : null,
  );

  useEffect(() => {
    if (!imageMode || !postImageUrl || analysis.image_size) return;
    const img = new Image();
    img.onload = () => setNaturalSize([img.naturalWidth, img.naturalHeight]);
    img.src = postImageUrl;
  }, [imageMode, postImageUrl, analysis.image_size]);

  const geoZones = useMemo(
    () =>
      analysis.zones.filter(
        (zone): zone is GeoZone =>
          typeof zone.centroid_lat === "number" &&
          typeof zone.centroid_lng === "number",
      ),
    [analysis.zones],
  );

  const imageBounds = useMemo(() => {
    if (!imageMode) return null;
    const w = naturalSize?.[0] ?? analysis.image_size?.[0] ?? 1024;
    const h = naturalSize?.[1] ?? analysis.image_size?.[1] ?? 1024;
    // CRS.Simple: [y, x] with y increasing downward to match image pixels.
    return L.latLngBounds([
      [0, 0],
      [h, w],
    ]);
  }, [imageMode, naturalSize, analysis.image_size]);

  if (geoZones.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No ranked zones to plot.
      </div>
    );
  }

  if (imageMode && imageBounds) {
    const h = naturalSize?.[1] ?? analysis.image_size?.[1] ?? 1024;
    const w = naturalSize?.[0] ?? analysis.image_size?.[0] ?? 1024;
    return (
      <MapContainer
        crs={L.CRS.Simple}
        center={[h / 2, w / 2]}
        zoom={-1}
        minZoom={-3}
        maxZoom={4}
        scrollWheelZoom
        className="h-full w-full bg-slate-950"
      >
        <FitImageBounds bounds={imageBounds} />
        {postImageUrl && (
          <ImageOverlay url={postImageUrl} bounds={imageBounds} opacity={0.95} />
        )}
        {zoneMarkers(geoZones, true)}
      </MapContainer>
    );
  }

  const center: [number, number] = [
    geoZones.reduce((sum, z) => sum + z.centroid_lat, 0) / geoZones.length,
    geoZones.reduce((sum, z) => sum + z.centroid_lng, 0) / geoZones.length,
  ];

  return (
    <MapContainer
      center={center}
      zoom={16}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {zoneMarkers(geoZones, false)}
    </MapContainer>
  );
}
