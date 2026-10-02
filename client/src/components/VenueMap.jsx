import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";
import { 
  LuRadar, 
  LuUsers, 
  LuSave, 
  LuX, 
  LuShieldAlert, 
  LuLayers, 
  LuCoffee,
  LuTriangleAlert,
  LuCheck
} from "react-icons/lu";

const DENSITY_COLORS = [
  { min: 0, max: 99, color: "#10B981", label: "Low (0–99)" },
  { min: 100, max: 499, color: "#3B82F6", label: "Moderate (100–499)" },
  { min: 500, max: 999, color: "#F59E0B", label: "High (500–999)" },
  { min: 1000, max: Infinity, color: "#EF4444", label: "Critical (1000+)" },
];

const VOLUNTEER_COLOR = "#0EA5E9"; 
const VOLUNTEER_SELF_COLOR = "#38BDF8";
const VOLUNTEER_BREAK_COLOR = "#A855F7";

function getDensityColor(count) {
  for (const tier of DENSITY_COLORS) {
    if (count >= tier.min && count <= tier.max) return tier;
  }
  return DENSITY_COLORS[0];
}

function polarToCartesian(centerX, centerY, radiusX, radiusY, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: centerX + (radiusX * Math.cos(angleInRadians)),
    y: centerY + (radiusY * Math.sin(angleInRadians))
  };
}

function computeAutoZoneLayout(zonesList) {
  const n = zonesList.length;
  if (n === 0) return [];
  const rx = 0.36; 
  const ry = 0.35;
  const angleStep = 360 / n;
  const startOffset = 180;

  return zonesList.map((z, i) => {
    const angle = (startOffset + (i * angleStep)) % 360;
    const pos = polarToCartesian(0.5, 0.5, rx, ry, angle);
    const zName = typeof z === "string" ? z : (z.name || z.zone || `Zone ${i + 1}`);
    return {
      zone_id: z.id || `auto-${i}`,
      zone: zName,
      x: pos.x,
      y: pos.y,
      bounds: { left: pos.x - 0.08, top: pos.y - 0.06, width: 0.16, height: 0.12 },
      polygon: [
        { x: pos.x - 0.08, y: pos.y - 0.06 },
        { x: pos.x + 0.08, y: pos.y - 0.06 },
        { x: pos.x + 0.08, y: pos.y + 0.06 },
        { x: pos.x - 0.08, y: pos.y + 0.06 },
      ]
    };
  });
}

function parsePolygonPoints(poly, bounds, containerW, containerH, fallbackX = 0.5, fallbackY = 0.5) {
  if (Array.isArray(poly) && poly.length >= 3) {
    return poly.map((pt) => {
      const px = pt.x !== undefined ? pt.x : pt[0];
      const py = pt.y !== undefined ? pt.y : pt[1];
      return { x: px * containerW, y: py * containerH };
    });
  }

  if (bounds && bounds.width) {
    const l = (bounds.left ?? (fallbackX - 0.08)) * containerW;
    const t = (bounds.top ?? (fallbackY - 0.06)) * containerH;
    const w = (bounds.width ?? 0.16) * containerW;
    const h = (bounds.height ?? 0.12) * containerH;
    return [
      { x: l, y: t },
      { x: l + w, y: t },
      { x: l + w, y: t + h },
      { x: l, y: t + h },
    ];
  }

  // Fallback box around centroid
  const cx = fallbackX * containerW;
  const cy = fallbackY * containerH;
  const halfW = 45;
  const halfH = 30;
  return [
    { x: cx - halfW, y: cy - halfH },
    { x: cx + halfW, y: cy - halfH },
    { x: cx + halfW, y: cy + halfH },
    { x: cx - halfW, y: cy + halfH },
  ];
}

function getPolygonCentroid(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const p of pts) {
    sumX += p.x;
    sumY += p.y;
  }
  return { x: sumX / pts.length, y: sumY / pts.length };
}

export default function VenueMap({
  eventId,
  zones = [],
  mode = "viewer", 
  currentUserId = null,
  onZoneClick = null,
  selectedVolunteer = null,
  refreshTrigger = 0,
  onExitEditMode = null,
}) {
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 520 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Data states
  const [levels, setLevels] = useState([]);
  const [selectedLevelId, setSelectedLevelId] = useState(null);
  const [density, setDensity] = useState({});
  const [volPositions, setVolPositions] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [serverLayout, setServerLayout] = useState(null);
  const [editLayout, setEditLayout] = useState(null);

  // Active layer visibility toggles
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showVolunteers, setShowVolunteers] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);

  // Interaction states
  const [hoveredZone, setHoveredZone] = useState(null);
  const [hoveredVolunteer, setHoveredVolunteer] = useState(null);
  const [hoveredIncident, setHoveredIncident] = useState(null);
  const [draggedVol, setDraggedVol] = useState(null);
  const [previewPos, setPreviewPos] = useState(null);
  const [draggedZoneIndex, setDraggedZoneIndex] = useState(null);

  // 1. Fetch Venue Levels
  useEffect(() => {
    if (!eventId) return;
    api.get(`/api/venue-map/${eventId}/levels`)
      .then((data) => {
        const lvlList = data.levels || [];
        setLevels(lvlList);
        if (lvlList.length > 0 && !selectedLevelId) {
          setSelectedLevelId(lvlList[0].id);
        }
      })
      .catch(() => {
        // Levels optional if no venue attached
      });
  }, [eventId]);

  // 2. Fetch Map Data (Density, Volunteers, Layout, Incidents)
  const fetchData = useCallback(async () => {
    if (mode === "create-event" || !eventId) {
      setLoading(false);
      return;
    }
    try {
      const layoutUrl = selectedLevelId 
        ? `/api/venue-map/${eventId}/layout?level_id=${selectedLevelId}`
        : `/api/venue-map/${eventId}/layout`;

      const [densRes, volRes, layoutRes, incRes] = await Promise.all([
        api.get(`/api/venue-map/${eventId}/density`).catch(() => ({ density: {} })),
        api.get(`/api/venue-map/${eventId}/volunteers`).catch(() => ({ positions: [] })),
        api.get(layoutUrl).catch(() => ({ layout: null })),
        api.get(`/api/organizer/incidents/${eventId}`).catch(() => ({ incidents: [] })),
      ]);

      setDensity(densRes.density || {});
      setVolPositions(volRes.positions || []);
      if (layoutRes && layoutRes.layout && layoutRes.layout.length > 0) {
        setServerLayout(layoutRes.layout);
      }
      setIncidents((incRes.incidents || []).filter(i => i.status !== "resolved" && i.status !== "closed"));
    } catch {
      // Silently proceed
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedLevelId, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  // Poll for updates every 10s
  useEffect(() => {
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Responsive container observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setContainerSize({ w: width, h: Math.max(380, width * 0.58) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute fallback zones if layout not yet stored
  const effectiveZones = (serverLayout && serverLayout.length > 0) 
    ? serverLayout 
    : computeAutoZoneLayout(zones);

  useEffect(() => {
    if ((mode === "edit-zones" || mode === "create-event" || mode === "organizer") && !editLayout) {
      setEditLayout(effectiveZones);
    }
  }, [mode, effectiveZones, editLayout]);

  const activeLayout = (mode === "edit-zones" || mode === "create-event") ? (editLayout || effectiveZones) : effectiveZones;

  const currentLevel = levels.find(l => l.id === selectedLevelId);

  // Save layout
  const handleSaveLayout = async () => {
    if (!editLayout) return;
    if (mode === "create-event" && onExitEditMode) {
      onExitEditMode(editLayout);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        layout: editLayout.map(z => ({
          zone_id: z.zone_id || z.id,
          bounds: z.bounds || { left: z.x - 0.08, top: z.y - 0.06, width: 0.16, height: 0.12 }
        }))
      };
      await api.post(`/api/venue-map/${eventId}/layout`, payload);
      setServerLayout(editLayout);
      if (onExitEditMode) onExitEditMode();
    } catch {
      alert("Failed to save layout positions.");
    } finally {
      setSaving(false);
    }
  };

  // Drag Zone Centroids in Edit Mode
  const handlePointerDownZone = (e, index) => {
    if (mode !== "edit-zones" && mode !== "create-event") return;
    e.stopPropagation();
    setDraggedZoneIndex(index);
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerDownVol = (e, volId, origX, origY) => {
    if (mode !== "organizer" && mode !== "edit-zones") return;
    e.stopPropagation();
    setDraggedVol(volId);
    setPreviewPos({ x: origX, y: origY });
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (draggedVol) {
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      x = Math.max(0, Math.min(x, rect.width));
      y = Math.max(0, Math.min(y, rect.height));
      setPreviewPos({ x: (x / rect.width) * 100, y: (y / rect.height) * 100 });
      return;
    }

    if (draggedZoneIndex !== null && editLayout) {
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      x = Math.max(20, Math.min(x, rect.width - 20));
      y = Math.max(20, Math.min(y, rect.height - 20));

      const relX = x / rect.width;
      const relY = y / rect.height;

      setEditLayout(prev => {
        const next = [...prev];
        const item = next[draggedZoneIndex];
        const w = item.bounds?.width || 0.16;
        const h = item.bounds?.height || 0.12;
        const newBounds = {
          left: Math.max(0, relX - w / 2),
          top: Math.max(0, relY - h / 2),
          width: w,
          height: h
        };
        next[draggedZoneIndex] = {
          ...item,
          x: relX,
          y: relY,
          bounds: newBounds,
          polygon: [
            { x: newBounds.left, y: newBounds.top },
            { x: newBounds.left + w, y: newBounds.top },
            { x: newBounds.left + w, y: newBounds.top + h },
            { x: newBounds.left, y: newBounds.top + h },
          ]
        };
        return next;
      });
    }
  };

  const handlePointerUp = (e) => {
    if (draggedVol) {
      const finalVol = draggedVol;
      const finalPos = previewPos;
      setDraggedVol(null);
      setPreviewPos(null);
      try { e.target.releasePointerCapture(e.pointerId); } catch {}

      if (finalPos && onZoneClick) {
        // Find closest zone
        let closest = activeLayout[0]?.zone || "Unknown";
        let minD = Infinity;
        for (const z of activeLayout) {
          const dx = (z.x * 100) - finalPos.x;
          const dy = (z.y * 100) - finalPos.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < minD) {
            minD = dist;
            closest = z.zone;
          }
        }
        onZoneClick(closest, finalPos.x, finalPos.y, finalVol);
      }
    }

    if (draggedZoneIndex !== null) {
      setDraggedZoneIndex(null);
      try { e.target.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  return (
    <div className="venue-map-wrapper" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      
      {/* Top Map Controls: Levels & Layer Toggles */}
      <div style={{ 
        display: "flex", 
        flexWrap: "wrap", 
        justifyContent: "space-between", 
        alignItems: "center", 
        gap: "12px", 
        background: "var(--bg-secondary)", 
        padding: "8px 14px", 
        borderRadius: "10px", 
        border: "1px solid var(--border-light)" 
      }}>
        {/* Floor Level Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Floor Level:
          </span>
          {levels.length === 0 ? (
            <span className="badge badge-neutral" style={{ fontSize: "0.8rem" }}>Main Floor</span>
          ) : (
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                type="button"
                className={`btn btn-sm ${!selectedLevelId ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setSelectedLevelId(null)}
                style={{ padding: "4px 10px", fontSize: "0.8rem" }}
              >
                All
              </button>
              {levels.map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  className={`btn btn-sm ${selectedLevelId === lvl.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setSelectedLevelId(lvl.id)}
                  style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                >
                  {lvl.short_code || lvl.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Layer Visibility Toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className={`btn btn-sm ${showHeatmap ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setShowHeatmap(!showHeatmap)}
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
            title="Toggle Crowd Heatmap"
          >
            <LuRadar size={14} color={showHeatmap ? "var(--warning)" : "var(--text-muted)"} />
            <span>Heatmap</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${showVolunteers ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setShowVolunteers(!showVolunteers)}
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
            title="Toggle Volunteer Pins"
          >
            <LuUsers size={14} color={showVolunteers ? "var(--info)" : "var(--text-muted)"} />
            <span>Staff ({volPositions.length})</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${showIncidents ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setShowIncidents(!showIncidents)}
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
            title="Toggle Incident Pins"
          >
            <LuShieldAlert size={14} color={showIncidents ? "var(--error)" : "var(--text-muted)"} />
            <span>Incidents ({incidents.length})</span>
          </button>

          {/* Edit Mode Save Button */}
          {(mode === "edit-zones" || mode === "create-event") && (
            <div style={{ display: "flex", gap: "6px", marginLeft: "8px" }}>
              {mode === "edit-zones" && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onExitEditMode}>
                  <LuX size={14} /> Cancel
                </button>
              )}
              <button 
                type="button" 
                className="btn btn-sm btn-primary" 
                onClick={handleSaveLayout}
                disabled={saving}
              >
                <LuSave size={14} /> {saving ? "Saving..." : "Save Layout"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div 
        className="venue-map-container" 
        ref={containerRef} 
        style={{ 
          position: "relative", 
          width: "100%", 
          borderRadius: "12px", 
          overflow: "hidden", 
          border: "1px solid var(--border-light)",
          backgroundColor: "#080c16",
          userSelect: "none"
        }}
      >
        {loading && (
          <div className="venue-map-loading" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", zIndex: 10 }}>
            <div className="spinner"></div>
          </div>
        )}

        <svg
          width={containerSize.w}
          height={containerSize.h}
          viewBox={`0 0 ${containerSize.w} ${containerSize.h}`}
          className="venue-map-svg"
          style={{ display: "block", cursor: (mode === "edit-zones" || mode === "create-event") ? "crosshair" : "default" }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <defs>
            {/* Dark tech blueprint pattern */}
            <pattern id="spatiallyBlueprintGrid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
            </pattern>

            {/* Glowing filter for high-density zone heat */}
            <filter id="heatGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Pulsing incident glow filter */}
            <filter id="incidentGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background: Map Asset Image OR Blueprint Grid */}
          <rect width={containerSize.w} height={containerSize.h} fill="#090e1a" />
          <rect width={containerSize.w} height={containerSize.h} fill="url(#spatiallyBlueprintGrid)" />

          {currentLevel?.map_asset_url && (
            <image
              href={currentLevel.map_asset_url}
              x="0"
              y="0"
              width={containerSize.w}
              height={containerSize.h}
              preserveAspectRatio="xMidYMid slice"
              opacity="0.5"
            />
          )}

          {/* Zones Layer (Dynamic Polygon from venue_zones.polygon / bounds) */}
          {activeLayout.map((zl, i) => {
            const zName = zl.zone || zl.name || `Zone ${i + 1}`;
            const count = density[zName] || 0;
            const tier = getDensityColor(count);
            const isHovered = hoveredZone === zName;
            const isEdit = (mode === "edit-zones" || mode === "create-event");

            const pts = parsePolygonPoints(zl.polygon, zl.bounds, containerSize.w, containerSize.h, zl.x, zl.y);
            const centroid = getPolygonCentroid(pts);
            const pointsStr = pts.map(p => `${p.x},${p.y}`).join(" ");

            // Opacity & colors
            const capacity = zl.operating_capacity || zl.capacity_limit || 500;
            const ratio = capacity > 0 ? count / capacity : 0;
            const isCriticalCrowd = ratio > 0.90 || count >= 1000;

            let fillColor = tier.color;
            let fillOpacity = showHeatmap ? Math.min(0.55, Math.max(0.18, 0.15 + (ratio * 0.35))) : 0.08;
            let strokeColor = isEdit ? "var(--primary)" : (isHovered ? "#38BDF8" : tier.color);

            // Operational status checks
            const status = zl.operational_status;
            if (status === "emergency_evacuated") {
              fillColor = "#EF4444";
              strokeColor = "#EF4444";
              fillOpacity = 0.5;
            } else if (status === "restricted_staff_only") {
              fillColor = "#F59E0B";
              strokeColor = "#F59E0B";
            }

            return (
              <g 
                key={zl.zone_id || zl.id || zName}
                onMouseEnter={() => setHoveredZone(zName)}
                onMouseLeave={() => setHoveredZone(null)}
                style={{ cursor: isEdit ? "move" : "pointer" }}
              >
                {/* Zone Polygon */}
                <polygon
                  points={pointsStr}
                  fill={fillColor}
                  fillOpacity={fillOpacity}
                  stroke={strokeColor}
                  strokeWidth={isHovered || isEdit ? 2.5 : 1.5}
                  strokeDasharray={isEdit ? "4 4" : "none"}
                  filter={isCriticalCrowd && showHeatmap ? "url(#heatGlow)" : undefined}
                  style={{ transition: "all 0.2s ease" }}
                />

                {/* Zone Label Centroid Card */}
                <g 
                  transform={`translate(${centroid.x}, ${centroid.y})`}
                  onPointerDown={(e) => isEdit && handlePointerDownZone(e, i)}
                  style={{ cursor: isEdit ? "grab" : "default" }}
                >
                  <rect
                    x="-48"
                    y="-20"
                    width="96"
                    height="40"
                    rx="8"
                    fill="rgba(15, 23, 42, 0.85)"
                    stroke={strokeColor}
                    strokeWidth="1.2"
                    style={{ backdropFilter: "blur(6px)" }}
                  />

                  <text
                    y="-4"
                    textAnchor="middle"
                    fill="#F8FAFC"
                    fontSize="11"
                    fontWeight="700"
                    fontFamily="Inter, sans-serif"
                    pointerEvents="none"
                  >
                    {zName}
                  </text>

                  <text
                    y="11"
                    textAnchor="middle"
                    fill={tier.color}
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="Inter, sans-serif"
                    pointerEvents="none"
                  >
                    {count} {count === 1 ? "person" : "people"}
                  </text>

                  {/* Operational status alert badge */}
                  {status && status !== "active" && status !== "open" && (
                    <circle cx="40" cy="-14" r="5" fill="#EF4444" stroke="#0F172A" strokeWidth="1.5" />
                  )}
                </g>
              </g>
            );
          })}

          {/* Incident Pins Layer */}
          {showIncidents && incidents.map((inc) => {
            // Find incident position: look up zone centroid or fallback
            const targetZone = activeLayout.find(z => (z.zone || z.name) === inc.zone_name);
            let ix = 0.5 * containerSize.w;
            let iy = 0.5 * containerSize.h;
            if (targetZone) {
              const pts = parsePolygonPoints(targetZone.polygon, targetZone.bounds, containerSize.w, containerSize.h, targetZone.x, targetZone.y);
              const c = getPolygonCentroid(pts);
              ix = c.x + 22; // Offset slightly from center
              iy = c.y - 20;
            }

            const isUrgent = inc.priority === "urgent" || inc.priority === "critical";
            const pinColor = isUrgent ? "#EF4444" : (inc.priority === "elevated" || inc.priority === "high" ? "#F59E0B" : "#3B82F6");
            const isHovered = hoveredIncident === inc.id;

            return (
              <g 
                key={inc.id}
                transform={`translate(${ix}, ${iy})`}
                onMouseEnter={() => setHoveredIncident(inc.id)}
                onMouseLeave={() => setHoveredIncident(null)}
                style={{ cursor: "pointer" }}
                filter="url(#incidentGlow)"
              >
                {/* Pulsing ring for urgent */}
                {isUrgent && (
                  <circle
                    r="14"
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    className="ble-radius-pulse"
                    opacity="0.8"
                  />
                )}

                <circle
                  r={isHovered ? "10" : "8"}
                  fill={pinColor}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />

                <text
                  y="3"
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="9"
                  fontWeight="900"
                  fontFamily="Inter, sans-serif"
                  pointerEvents="none"
                >
                  !
                </text>

                {/* Tooltip on hover */}
                {isHovered && (
                  <g transform="translate(0, -18)">
                    <rect
                      x="-70"
                      y="-24"
                      width="140"
                      height="24"
                      rx="6"
                      fill="rgba(15, 23, 42, 0.95)"
                      stroke={pinColor}
                      strokeWidth="1"
                    />
                    <text
                      y="-8"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="Inter, sans-serif"
                    >
                      {inc.title?.slice(0, 18) || "Incident"} ({inc.priority})
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Volunteer Pins Layer (from volunteer_shifts) */}
          {showVolunteers && volPositions.map((v) => {
            const isDragged = draggedVol === v.volunteer_user_id;
            const posX = isDragged && previewPos ? previewPos.x : v.pos_x;
            const posY = isDragged && previewPos ? previewPos.y : v.pos_y;
            
            const dotX = (posX / 100) * containerSize.w;
            const dotY = (posY / 100) * containerSize.h;
            
            const isSelf = v.volunteer_user_id === currentUserId;
            const isSelected = v.volunteer_user_id === selectedVolunteer;
            const isHovered = hoveredVolunteer === v.volunteer_user_id || isDragged;
            const isOnBreak = v.break_state === "taking_break" || v.break_state === "on_break";
            const pinColor = isOnBreak ? VOLUNTEER_BREAK_COLOR : (isSelf ? VOLUNTEER_SELF_COLOR : VOLUNTEER_COLOR);
            const dotR = isSelf ? 8 : 6.5;

            return (
              <g 
                key={v.volunteer_user_id || v.shift_id} 
                onMouseEnter={() => setHoveredVolunteer(v.volunteer_user_id)}
                onMouseLeave={() => setHoveredVolunteer(null)}
                style={{ cursor: mode === "organizer" ? (isDragged ? "grabbing" : "grab") : "pointer" }}
              >
                {(isHovered || isSelected) && (
                  <circle
                    cx={dotX}
                    cy={dotY}
                    r={32}
                    fill="rgba(14, 165, 233, 0.15)"
                    stroke="rgba(14, 165, 233, 0.6)"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    className="ble-radius-pulse"
                    pointerEvents="none"
                  />
                )}
                
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={isDragged ? dotR * 1.4 : dotR}
                  fill={pinColor}
                  stroke="#FFFFFF"
                  strokeWidth="1.8"
                  onPointerDown={(e) => handlePointerDownVol(e, v.volunteer_user_id, posX, posY)}
                />

                {/* Volunteer Name Pill */}
                <text
                  x={dotX}
                  y={dotY - (isDragged ? dotR * 1.4 : dotR) - 6}
                  textAnchor="middle"
                  fill="#F8FAFC"
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="Inter, sans-serif"
                  pointerEvents="none"
                  style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
                >
                  {v.volunteer_name || v.volunteer_user_id?.slice(0, 8)}
                </text>

                {/* Break status indicator */}
                {isOnBreak && (
                  <text
                    x={dotX}
                    y={dotY + (isDragged ? dotR * 1.4 : dotR) + 12}
                    textAnchor="middle"
                    fill="#D8B4FE"
                    fontSize="9"
                    fontWeight="600"
                    fontFamily="Inter, sans-serif"
                    pointerEvents="none"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
                  >
                    ☕ On Break
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Modern Legend Bar */}
      <div className="venue-map-legend" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", background: "var(--bg-secondary)", padding: "10px 16px", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <div className="venue-map-legend-title" style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
            <LuUsers size={14} /> Crowd Density:
          </div>
          {DENSITY_COLORS.map((tier) => (
            <div key={tier.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: tier.color }} />
              <span>{tier.label}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: VOLUNTEER_COLOR }} />
            <span>Staff</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: VOLUNTEER_BREAK_COLOR }} />
            <span>On Break</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#EF4444" }} />
            <span>Incident</span>
          </div>
        </div>
      </div>

    </div>
  );
}
