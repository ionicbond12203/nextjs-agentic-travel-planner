"use client";

import React, { useState } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow } from "@vis.gl/react-google-maps";

interface Location {
  lat: number;
  lng: number;
  label: string;
  description?: string;
}

interface MapInnerProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers: Location[];
}

const MapInner: React.FC<MapInnerProps> = ({
  center,
  zoom = 13,
  markers = [],
}) => {
  const mapCenter = center 
    ? { lat: center.lat, lng: center.lng }
    : markers.length > 0 
      ? { lat: markers[0].lat, lng: markers[0].lng } 
      : { lat: 48.8566, lng: 2.3522 };

  const [openInfoWindow, setOpenInfoWindow] = useState<string | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  if (!apiKey) {
    return (
      <div className="h-[350px] w-full flex items-center justify-center bg-surface-hover text-sm text-balance rounded-xl">
        请在环境变量中设置 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      </div>
    );
  }

  return (
    <div className="h-[350px] w-full">
      <APIProvider apiKey={apiKey}>
        <Map
          defaultCenter={mapCenter}
          defaultZoom={zoom}
          gestureHandling={"greedy"}
          disableDefaultUI={false}
          mapId="DEMO_MAP_ID"
          style={{ width: "100%", height: "100%" }}
        >
          {markers.map((marker, idx) => {
            const key = `${marker.lat}-${marker.lng}-${idx}`;
            return (
              <AdvancedMarker
                key={key}
                position={{ lat: marker.lat, lng: marker.lng }}
                title={marker.label}
                onClick={() => setOpenInfoWindow(key)}
              >
                <div style={{ 
                  backgroundColor: "var(--color-accent, #3b82f6)", 
                  width: "14px", 
                  height: "14px", 
                  borderRadius: "50%", 
                  border: "2px solid white", 
                  boxShadow: "0 0 10px rgba(0,0,0,0.3)",
                  transform: "translateY(50%)"
                }} />
                {openInfoWindow === key && (
                  <InfoWindow
                    position={{ lat: marker.lat, lng: marker.lng }}
                    onCloseClick={() => setOpenInfoWindow(null)}
                  >
                    <div className="p-1 max-w-[200px]">
                      <h4 className="font-bold text-slate-800 text-sm whitespace-normal">{marker.label}</h4>
                      {marker.description && (
                        <p className="text-xs text-slate-600 mt-1 whitespace-normal">{marker.description}</p>
                      )}
                    </div>
                  </InfoWindow>
                )}
              </AdvancedMarker>
            );
          })}
        </Map>
      </APIProvider>
    </div>
  );
};

export default MapInner;
