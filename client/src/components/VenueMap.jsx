import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  const [showMeshGraph, setShowMeshGraph] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);

  // Interaction states (MUST be declared before graphEdges useMemo)
  const [hoveredZone, setHoveredZone] = useState(null);
  const [hoveredVolunteer, setHoveredVolunteer] = useState(null);
  const [hoveredIncident, setHoveredIncident] = useState(null);
  const [draggedVol, setDraggedVol] = useState(null);
  const [previewPos, setPreviewPos] = useState(null);
  const [draggedZoneIndex, setDraggedZoneIndex] = useState(null);

  // Compute tactical network graph topology between volunteer nodes
  const graphEdges = useMemo(() => {
    if (!volPositions || !Array.isArray(volPositions) || volPositions.length < 2) return [];
    const validNodes = [];
    volPositions.forEach((v, idx) => {
      if (!v) return;
      const isDragged = draggedVol === v.volunteer_user_id;
      const posX = Number(isDragged && previewPos ? previewPos.x : (v.pos_x ?? 50));
      const posY = Number(isDragged && previewPos ? previewPos.y : (v.pos_y ?? 50));
      if (isNaN(posX) || isNaN(posY)) return;

      const cw = containerSize?.w || 800;
      const ch = containerSize?.h || 520;
      const x = (posX / 100) * cw;
      const y = (posY / 100) * ch;
      const isOvercrowded = Boolean(
        v.is_overcrowded || 
        (v.crowd_ratio && v.crowd_ratio >= 0.85) || 
        v.node_color === "#EF4444"
      );
      validNodes.push({
        id: v.volunteer_user_id || v.shift_id || `vol-${idx}`,
        x,
        y,
        isOvercrowded,
        name: v.volunteer_name || "Volunteer",
      });
    });

    if (validNodes.length < 2) return [];

    const edges = [];
    const seen = new Set();
    const k = Math.min(2, validNodes.length - 1);

    for (let i = 0; i < validNodes.length; i++) {
      const distances = [];
      for (let j = 0; j < validNodes.length; j++) {
        if (i === j) continue;
        const dx = validNodes[i].x - validNodes[j].x;
        const dy = validNodes[i].y - validNodes[j].y;
        distances.push({ target: j, dist: Math.hypot(dx, dy) });
      }
      distances.sort((a, b) => a.dist - b.dist);
      for (let m = 0; m < k; m++) {
        if (!distances[m]) continue;
        const j = distances[m].target;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          const isAlertEdge = Boolean(validNodes[i]?.isOvercrowded || validNodes[j]?.isOvercrowded);
          edges.push({
            key,
            x1: validNodes[i].x,
            y1: validNodes[i].y,
            x2: validNodes[j].x,
            y2: validNodes[j].y,
            isAlertEdge,
          });
        }
      }
    }
    return edges;
  }, [volPositions, draggedVol, previewPos, containerSize]);

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
            className={`btn btn-sm ${showMeshGraph ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setShowMeshGraph(!showMeshGraph)}
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
            title="Toggle Volunteer Mesh Network Graph"
          >
            <LuLayers size={14} color={showMeshGraph ? "#38BDF8" : "var(--text-muted)"} />
            <span>Mesh Graph</span>
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

            {/* Tactical Volunteer Node Filter */}
            <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Critical Alert Beacon Glow Filter */}
            <filter id="alertGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#EF4444" floodOpacity="0.85" />
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

          {/* Tactical Volunteer Mesh Graph Links Layer */}
          {showVolunteers && showMeshGraph && (
            <g className="tactical-network-mesh-edges">
              {graphEdges.map((edge) => (
                <g key={edge.key}>
                  {/* Outer glow line for alert edges */}
                  {edge.isAlertEdge && (
                    <line
                      x1={edge.x1}
                      y1={edge.y1}
                      x2={edge.x2}
                      y2={edge.y2}
                      stroke="#EF4444"
                      strokeWidth="5"
                      strokeOpacity="0.25"
                      strokeLinecap="round"
                    />
                  )}
                  {/* Main tactical dashed link */}
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke={edge.isAlertEdge ? "#EF4444" : "rgba(56, 189, 248, 0.45)"}
                    strokeWidth={edge.isAlertEdge ? 2.5 : 1.6}
                    className={edge.isAlertEdge ? "tactical-edge-alert" : "tactical-edge-normal"}
                    strokeLinecap="round"
                  />
                  {/* Telemetry packet node at center */}
                  <circle
                    cx={(edge.x1 + edge.x2) / 2}
                    cy={(edge.y1 + edge.y2) / 2}
                    r={edge.isAlertEdge ? 3.5 : 2.5}
                    fill={edge.isAlertEdge ? "#EF4444" : "#38BDF8"}
                    opacity={edge.isAlertEdge ? 0.95 : 0.7}
                  />
                </g>
              ))}
            </g>
          )}

          {/* Volunteer Graph Nodes Layer (with dynamic crowd telemetry) */}
          {showVolunteers && volPositions.map((v) => {
            const isDragged = draggedVol === v.volunteer_user_id;
            const rawX = isDragged && previewPos ? previewPos.x : v.pos_x;
            const rawY = isDragged && previewPos ? previewPos.y : v.pos_y;
            const posX = Number(rawX ?? 50);
            const posY = Number(rawY ?? 50);
            
            const cw = containerSize?.w || 800;
            const ch = containerSize?.h || 520;
            const dotX = isNaN(posX) ? cw / 2 : (posX / 100) * cw;
            const dotY = isNaN(posY) ? ch / 2 : (posY / 100) * ch;
            
            const isSelf = v.volunteer_user_id === currentUserId;
            const isSelected = v.volunteer_user_id === selectedVolunteer;
            const isHovered = hoveredVolunteer === v.volunteer_user_id || isDragged;
            const isOnBreak = v.break_state === "taking_break" || v.break_state === "on_break";

            // Live Crowd Proximity Telemetry & Node Color
            const isOvercrowded = Boolean(
              v.is_overcrowded || 
              (v.crowd_ratio && v.crowd_ratio >= 0.85) || 
              v.node_color === "#EF4444"
            );

            // Red when overcrowded, amber when elevated (65-85%), blue when moderate (40-65%), green when safe (<40%)
            const nodeColor = isOvercrowded 
              ? "#EF4444" 
              : (v.node_color || (v.crowd_ratio >= 0.65 ? "#F59E0B" : (v.crowd_ratio >= 0.40 ? "#3B82F6" : "#10B981")));

            const dotR = isSelf ? 9.5 : 8.5;
            const nearbyCount = v.active_count ?? (isOvercrowded ? 172 : 35);
            const capacity = v.operating_capacity || 100;
            const pct = Math.round((v.crowd_ratio ? v.crowd_ratio * 100 : (nearbyCount / capacity) * 100));

            return (
              <g 
                key={v.volunteer_user_id || v.shift_id} 
                onMouseEnter={() => setHoveredVolunteer(v.volunteer_user_id)}
                onMouseLeave={() => setHoveredVolunteer(null)}
                style={{ cursor: mode === "organizer" ? (isDragged ? "grabbing" : "grab") : "pointer" }}
              >
                {/* 1. Pulsing Radar Ring Beacons (Overcrowded Red Alert) */}
                {isOvercrowded && (
                  <>
                    <circle
                      cx={dotX}
                      cy={dotY}
                      r={36}
                      fill="rgba(239, 68, 68, 0.16)"
                      stroke="#EF4444"
                      strokeWidth="1.8"
                      strokeDasharray="4 4"
                      className="alert-beacon-pulse"
                      pointerEvents="none"
                    />
                    <circle
                      cx={dotX}
                      cy={dotY}
                      r={24}
                      fill="none"
                      stroke="#EF4444"
                      strokeWidth="2"
                      className="ble-radius-pulse"
                      pointerEvents="none"
                    />
                  </>
                )}

                {/* 2. Soft Tactical Pulse Ring for Normal / Hover Nodes */}
                {!isOvercrowded && (isHovered || isSelected) && (
                  <circle
                    cx={dotX}
                    cy={dotY}
                    r={28}
                    fill="rgba(56, 189, 248, 0.15)"
                    stroke={nodeColor}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    className="ble-radius-pulse"
                    pointerEvents="none"
                  />
                )}
                
                {/* 3. Outer Tactical Reticle Ring */}
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={(isDragged ? dotR * 1.3 : dotR) + 3.5}
                  fill="none"
                  stroke={nodeColor}
                  strokeWidth="1.2"
                  strokeDasharray={isOvercrowded ? "3 3" : "none"}
                  opacity="0.8"
                  pointerEvents="none"
                />

                {/* 4. Volunteer Node Core Body (Dynamically Colored) */}
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={isDragged ? dotR * 1.3 : dotR}
                  fill={nodeColor}
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  filter={isOvercrowded ? "url(#alertGlow)" : "url(#nodeGlow)"}
                  onPointerDown={(e) => handlePointerDownVol(e, v.volunteer_user_id, posX, posY)}
                />

                {/* 5. Center Tactical Target Dot */}
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={2.8}
                  fill="#FFFFFF"
                  pointerEvents="none"
                />

                {/* 6. Volunteer Name Pill Tag (Above Node) */}
                <g transform={`translate(${dotX}, ${dotY - (isDragged ? dotR * 1.3 : dotR) - 10})`} pointerEvents="none">
                  <rect
                    x="-44"
                    y="-14"
                    width="88"
                    height="18"
                    rx="5"
                    fill="rgba(15, 23, 42, 0.9)"
                    stroke={nodeColor}
                    strokeWidth="1"
                  />
                  <text
                    y="-2"
                    textAnchor="middle"
                    fill="#F8FAFC"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="Inter, sans-serif"
                  >
                    {(v.volunteer_name || "Volunteer").length > 14 
                      ? (v.volunteer_name || "Volunteer").slice(0, 13) + "…" 
                      : (v.volunteer_name || "Volunteer")}
                  </text>
                </g>

                {/* 7. Live Crowd Count Telemetry Badge (Below Node) */}
                <g transform={`translate(${dotX}, ${dotY + (isDragged ? dotR * 1.3 : dotR) + 12})`} pointerEvents="none">
                  <rect
                    x="-38"
                    y="-10"
                    width="76"
                    height="19"
                    rx="9.5"
                    fill={isOvercrowded ? "#EF4444" : "rgba(15, 23, 42, 0.9)"}
                    stroke={isOvercrowded ? "#FECACA" : nodeColor}
                    strokeWidth="1.2"
                  />
                  <text
                    y="3.5"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="9.5"
                    fontWeight="800"
                    fontFamily="Inter, sans-serif"
                  >
                    {isOvercrowded ? `⚠️ ${nearbyCount} (${pct}%)` : `👥 ${nearbyCount} (${pct}%)`}
                  </text>
                </g>

                {/* 8. Break Status Indicator */}
                {isOnBreak && (
                  <text
                    x={dotX}
                    y={dotY + (isDragged ? dotR * 1.3 : dotR) + 32}
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

                {/* 9. Full Tactical HUD Card on Hover */}
                {isHovered && (
                  <g transform={`translate(${dotX}, ${dotY - 62})`} style={{ zIndex: 100 }} pointerEvents="none">
                    <rect
                      x="-85"
                      y="-46"
                      width="170"
                      height="46"
                      rx="8"
                      fill="rgba(10, 15, 30, 0.95)"
                      stroke={nodeColor}
                      strokeWidth="1.5"
                      filter="url(#incidentGlow)"
                    />
                    <text
                      x="0"
                      y="-30"
                      textAnchor="middle"
                      fill="#F8FAFC"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="Inter, sans-serif"
                    >
                      {v.volunteer_name || "Volunteer Node"}
                    </text>
                    <text
                      x="0"
                      y="-17"
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize="9.5"
                      fontWeight="500"
                      fontFamily="Inter, sans-serif"
                    >
                      Sector: {v.zone} {isOnBreak ? "(On Break)" : ""}
                    </text>
                    <text
                      x="0"
                      y="-4"
                      textAnchor="middle"
                      fill={nodeColor}
                      fontSize="10"
                      fontWeight="800"
                      fontFamily="Inter, sans-serif"
                    >
                      {isOvercrowded 
                        ? `CRITICAL OVERCROWDING: ${nearbyCount}/${capacity} (${pct}%)` 
                        : `Live Crowd: ${nearbyCount}/${capacity} (${pct}%)`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Modern Tactical Network Legend Bar */}
      <div className="venue-map-legend" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", background: "var(--bg-secondary)", padding: "10px 16px", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <div className="venue-map-legend-title" style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
            <LuUsers size={14} /> Volunteer Node Density:
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#EF4444" }} />
            <span>Overcrowded (≥85%)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#F59E0B" }} />
            <span>Busy (65–85%)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#3B82F6" }} />
            <span>Moderate (40–65%)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#10B981" }} />
            <span>Safe (&lt;40%)</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "18px", height: "2px", borderTop: "2px dashed #38BDF8" }} />
            <span>Tactical Mesh Link</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: VOLUNTEER_BREAK_COLOR }} />
            <span>On Break</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#EF4444" }} />
            <span>Incident Alert</span>
          </div>
        </div>
      </div>

    </div>
  );
}
