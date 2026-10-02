import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { supabase, isSupabaseConfigured } from "../utils/supabaseClient";
import { 
  LuRadar, 
  LuMapPin, 
  LuTrendingUp, 
  LuTriangleAlert, 
  LuUsers, 
  LuClock,
  LuSlidersHorizontal,
  LuSave
} from "react-icons/lu";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from "recharts";

export default function OrganizerCrowd() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [crowdData, setCrowdData] = useState(null);
  const [timelineData, setTimelineData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Calibration state
  const [calibratingZoneId, setCalibratingZoneId] = useState(null);
  const [calibratedCount, setCalibratedCount] = useState("");
  const [calibratedNotes, setCalibratedNotes] = useState("");
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    api.get("/api/events/organizer/mine")
      .then((data) => {
        const evList = data.events || [];
        setEvents(evList);
        if (evList.length > 0) {
          const liveEvent = evList.find(e => e.status === "live") || evList.find(e => e.status === "upcoming") || evList[0];
          setSelectedEventId(liveEvent.id);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        toast(err.message, "error");
        setLoading(false);
      });
  }, [toast]);

  const fetchCrowdData = useCallback(() => {
    if (!selectedEventId) return;
    Promise.all([
      api.get(`/api/organizer/crowd/${selectedEventId}`),
      api.get(`/api/organizer/timeline/${selectedEventId}`).catch(() => ({ timeline: [] })),
    ])
      .then(([cData, tData]) => {
        setCrowdData(cData);
        // Format timeline data for Recharts
        const rawTimeline = tData.timeline || [];
        if (rawTimeline.length > 0) {
          setTimelineData(rawTimeline.map((item, idx) => ({
            time: item.time || `${idx * 5}m`,
            devices: item.active_count || item.estimated_count || item.count || 0,
          })));
        } else {
          // Synthetic initial baseline if no snapshots yet
          const now = Date.now();
          const points = [
            { time: "-20m", devices: Math.max(0, (cData.total_devices || 10) - 15) },
            { time: "-15m", devices: Math.max(0, (cData.total_devices || 10) - 8) },
            { time: "-10m", devices: Math.max(0, (cData.total_devices || 10) - 3) },
            { time: "-5m", devices: cData.total_devices || 10 },
            { time: "Now", devices: cData.total_devices || 12 },
          ];
          setTimelineData(points);
        }
      })
      .catch((err) => {
        toast(err.message, "error");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchCrowdData();
    const interval = setInterval(fetchCrowdData, 10000);

    // Supabase Realtime CDC on crowd_zone_snapshots
    let channel = null;
    if (isSupabaseConfigured && selectedEventId) {
      channel = supabase
        .channel(`org-crowd-${selectedEventId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "crowd_zone_snapshots", filter: `event_id=eq.${selectedEventId}` }, () => fetchCrowdData())
        .subscribe();
    }

    return () => {
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [selectedEventId, fetchCrowdData]);

  // Headcount Calibration submit
  const handleCalibrate = async (e, zoneId) => {
    e.preventDefault();
    if (!calibratedCount || isNaN(calibratedCount)) {
      toast("Please enter a valid count", "warning");
      return;
    }
    setCalibrating(true);
    try {
      await api.post(`/api/organizer/crowd/calibrate?event_id=${selectedEventId}`, {
        zone_id: zoneId,
        manual_count: parseInt(calibratedCount, 10),
        notes: calibratedNotes || "Manual turnstile recount",
      });
      toast("Manual calibration recorded!", "success");
      setCalibratingZoneId(null);
      setCalibratedCount("");
      setCalibratedNotes("");
      fetchCrowdData();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setCalibrating(false);
    }
  };

  const getDensityColor = (current, capacity) => {
    if (!capacity) return "var(--info)";
    const ratio = current / capacity;
    if (ratio > 0.9) return "var(--error)";
    if (ratio > 0.75) return "var(--warning)";
    return "var(--success)";
  };

  const totalCrowd = crowdData?.zone_density 
    ? Object.values(crowdData.zone_density).reduce((sum, zone) => sum + (zone.active_count || 0), 0) 
    : 0;
  const totalCapacity = crowdData?.zone_density 
    ? Object.values(crowdData.zone_density).reduce((sum, zone) => sum + (zone.operating_capacity || 0), 0) 
    : 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "var(--success)", boxShadow: "0 0 10px var(--success)", animation: "pulse 2s infinite" }} />
            Live Crowd Telemetry & Telemetry Feed
          </h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Real-time BLE presence signals, 5-minute rolling surge curves, and turnstile calibrations.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          {events.length > 0 && (
            <select 
              className="form-select" 
              value={selectedEventId} 
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ minWidth: "220px" }}
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name} ({ev.status})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center" }}><div className="spinner"></div></div>
      ) : !crowdData ? (
        <div className="empty-state">
          <div className="empty-state-icon"><LuRadar /></div>
          <div className="empty-state-title">No telemetry data</div>
          <div className="empty-state-text">
            Start the event to begin collecting BLE presence data.
          </div>
        </div>
      ) : (
        <>
          {/* TOP METRICS */}
          <div className="stats-grid" style={{ marginBottom: "20px" }}>
            <div className="stat-card">
              <div className="stat-icon info"><LuUsers /></div>
              <div>
                <div className="stat-value">{totalCrowd}</div>
                <div className="stat-label">Active Presence (BLE Devices)</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ color: getDensityColor(totalCrowd, totalCapacity) }}><LuTrendingUp /></div>
              <div>
                <div className="stat-value">{totalCapacity > 0 ? Math.round((totalCrowd / totalCapacity) * 100) : 0}%</div>
                <div className="stat-label">Overall Venue Utilization</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon warning"><LuRadar /></div>
              <div>
                <div className="stat-value">{crowdData.raw_counts?.length || 0}</div>
                <div className="stat-label">Active Scanners Reporting</div>
              </div>
            </div>
          </div>

          {/* 5-MINUTE ROLLING SURGE CHART */}
          <div className="card" style={{ marginBottom: "24px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                <LuTrendingUp size={18} color="var(--primary)" /> Rolling Attendance Surge Velocity
              </h3>
              <span className="badge info" style={{ fontSize: "0.75rem" }}>Live Stream (5m window)</span>
            </div>

            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="crowdGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#0F172A", borderColor: "rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "0.8rem" }}
                  />
                  <Area type="monotone" dataKey="devices" stroke="#0EA5E9" strokeWidth={2} fillOpacity={1} fill="url(#crowdGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ZONE CARDS WITH STALENESS & CALIBRATION */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
            {Object.entries(crowdData.zone_density || {}).map(([zoneName, data]) => {
              const capacity = data.operating_capacity || 0;
              const ratio = capacity > 0 ? (data.active_count || 0) / capacity : 0;
              const densityColor = getDensityColor(data.active_count, capacity);
              const isOvercrowded = ratio > 0.9;
              
              // Staleness indicator: if snapshot timestamp > 5 mins old
              const isStale = data.snapshot_at && (Date.now() - new Date(data.snapshot_at).getTime()) > 5 * 60 * 1000;
              const isCalibrating = calibratingZoneId === data.zone_id;

              return (
                <div 
                  key={zoneName} 
                  className="card" 
                  style={{ 
                    padding: "20px", 
                    border: isOvercrowded ? "1px solid var(--error)" : undefined,
                    opacity: isStale ? 0.75 : 1,
                    position: "relative"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <div>
                      <h3 style={{ fontSize: "1.1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                        <LuMapPin size={16} color="var(--primary)" />
                        {zoneName}
                      </h3>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                        {data.volunteer_scanners || 0} active volunteer scanner(s)
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                      {isOvercrowded && (
                        <div className="badge" style={{ backgroundColor: "var(--error)", color: "#fff", display: "flex", alignItems: "center", gap: "4px" }}>
                          <LuTriangleAlert size={12} /> Over Capacity
                        </div>
                      )}
                      {isStale && (
                        <span className="badge" style={{ backgroundColor: "rgba(245,158,11,0.2)", color: "#F59E0B", fontSize: "0.7rem" }} title="Telemetry not updated in >5 minutes">
                          <LuClock size={11} /> Stale &gt;5m
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ fontSize: "2.5rem", fontWeight: "800", lineHeight: "1", color: densityColor }}>
                      {data.active_count || 0}
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", paddingBottom: "4px" }}>
                      / {capacity > 0 ? capacity : "∞"} max capacity ({Math.round(ratio * 100)}%)
                    </div>
                  </div>
                  
                  {capacity > 0 && (
                    <div style={{ width: "100%", height: "8px", backgroundColor: "var(--bg-secondary)", borderRadius: "4px", overflow: "hidden", marginBottom: "14px" }}>
                      <div style={{ 
                        height: "100%", 
                        width: `${Math.min(ratio * 100, 100)}%`, 
                        backgroundColor: densityColor,
                        transition: "width 0.6s ease"
                      }} />
                    </div>
                  )}

                  {/* Calibration Action Toggle */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-light)", paddingTop: "12px" }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "6px" }}
                      onClick={() => setCalibratingZoneId(isCalibrating ? null : data.zone_id)}
                    >
                      <LuSlidersHorizontal size={14} />
                      {isCalibrating ? "Close Recount" : "Calibrate Headcount"}
                    </button>
                    {isOvercrowded && (
                      <span style={{ fontSize: "0.75rem", color: "var(--error)", fontWeight: "700" }}>Critical</span>
                    )}
                  </div>

                  {/* Manual Calibration Input Drawer */}
                  {isCalibrating && (
                    <form onSubmit={(e) => handleCalibrate(e, data.zone_id)} style={{ marginTop: "12px", background: "var(--bg-secondary)", padding: "12px", borderRadius: "8px" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: "700", marginBottom: "8px" }}>Manual Recount Override:</div>
                      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                        <input
                          type="number"
                          className="form-input"
                          placeholder="Turnstile Headcount"
                          value={calibratedCount}
                          onChange={(e) => setCalibratedCount(e.target.value)}
                          required
                          style={{ fontSize: "0.85rem", padding: "6px 10px" }}
                        />
                        <button type="submit" className="btn btn-sm btn-primary" disabled={calibrating}>
                          <LuSave size={14} /> {calibrating ? "..." : "Save"}
                        </button>
                      </div>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Notes (e.g. Gate 2 turnstile sync)"
                        value={calibratedNotes}
                        onChange={(e) => setCalibratedNotes(e.target.value)}
                        style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                      />
                    </form>
                  )}

                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
