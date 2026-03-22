"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";

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

// 1. Refactor: Use top-level next/dynamic with ssr: false
// This eliminates the need for manual 'mounted' state or 'require' hacks.
const DynamicMapInner = dynamic(() => import("./map-inner"), {
  ssr: false,
  loading: () => (
    <div className="h-[350px] w-full bg-surface-hover animate-pulse rounded-xl flex items-center justify-center text-muted text-sm">
      地图加载中...
    </div>
  ),
});

// 2. Refactor: Use React.memo to prevent expensive history re-renders
const InteractiveMap: React.FC<InteractiveMapProps> = React.memo(({
  title,
  center,
  zoom,
  markers = [],
}) => {
  // 3. Refactor: Defensive Validation
  // Ensure we don't crash if LLM sends malformed coordinates or empty markers
  const validatedMarkers = useMemo(() => {
    return Array.isArray(markers) 
      ? markers.filter(m => 
          typeof m.lat === 'number' && 
          typeof m.lng === 'number' && 
          !isNaN(m.lat) && !isNaN(m.lng)
        ).map(m => ({
          ...m,
          label: m.label || "未命名地点"
        }))
      : [];
  }, [markers]);

  // If no valid data, don't render the empty shell
  if (validatedMarkers.length === 0 && !center) {
    return (
      <div className="my-2 p-4 border border-border rounded-xl bg-surface-hover text-sm text-balance">
        ⚠️ 地图数据异常，无法显示位置。
      </div>
    );
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
      {title && (
        <div className="border-b border-border bg-surface-hover px-4 py-2 text-sm font-semibold text-strong">
          📍 {title}
        </div>
      )}
      <DynamicMapInner 
        center={center} 
        zoom={zoom} 
        markers={validatedMarkers} 
      />
    </div>
  );
});

// Set display name for debugging
InteractiveMap.displayName = "InteractiveMap";

export default InteractiveMap;
