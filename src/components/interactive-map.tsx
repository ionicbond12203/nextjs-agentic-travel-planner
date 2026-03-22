"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
// Local CSS import is more reliable in Next.js
import "leaflet/dist/leaflet.css";

interface Location {
  lat: number;
  lng: number;
  label: string;
  description?: string;
}

interface InteractiveMapProps {
  title?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  markers: Location[];
}

// Internal component that uses Leaflet hooks
// This will only be rendered on the client thanks to the dynamic wrapper below
const LeafletMapInner: React.FC<InteractiveMapProps> = ({
  center,
  zoom = 13,
  markers,
}) => {
  const { MapContainer, TileLayer, Marker, Popup, useMap } = require("react-leaflet");
  const L = require("leaflet");

  // Fix Leaflet marker icon issue
  const customIcon = L.divIcon({
    html: `<div style="background-color: var(--color-accent); width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
    className: "custom-div-icon",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  function ChangeView({ center, zoom }: { center: [number, number], zoom: number }) {
    const map = useMap();
    useEffect(() => {
      if (map) {
        // Essential fix for misaligned tiles in dynamic containers
        setTimeout(() => {
          map.invalidateSize();
          map.setView(center, zoom);
        }, 100);
      }
    }, [center, zoom, map]);
    return null;
  }

  const mapCenter: [number, number] = center 
    ? [center.lat, center.lng] 
    : markers.length > 0 
      ? [markers[0].lat, markers[0].lng] 
      : [48.8566, 2.3522];

  return (
    <div className="h-[350px] w-full">
      <MapContainer
        center={mapCenter}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        
        <ChangeView center={mapCenter} zoom={zoom} />

        {markers.map((marker, idx) => (
          <Marker 
            key={`${marker.lat}-${marker.lng}-${idx}`} 
            position={[marker.lat, marker.lng]}
            icon={customIcon}
          >
            <Popup>
              <div className="p-1">
                <h4 className="font-bold text-slate-800">{marker.label}</h4>
                {marker.description && <p className="text-xs text-slate-600 mt-1">{marker.description}</p>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

// The actual exported component that is safe to use in Next.js
const InteractiveMap: React.FC<InteractiveMapProps> = (props) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-[350px] w-full bg-surface-hover animate-pulse rounded-xl" />;
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
      {props.title && (
        <div className="border-b border-border bg-surface-hover px-4 py-2 text-sm font-semibold text-strong">
          📍 {props.title}
        </div>
      )}
      <LeafletMapInner {...props} />
    </div>
  );
};

export default InteractiveMap;
