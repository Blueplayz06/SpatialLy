import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { supabase, isSupabaseConfigured } from "../utils/supabaseClient";
import { 
  LuActivity, 
  LuTriangleAlert, 
  LuCircleCheck, 
  LuMapPin, 
  LuTicket, 
  LuUsers,
  LuShieldAlert,
  LuMessageSquare,
  LuRadio,
  LuChevronRight
} from "react-icons/lu";

export default function OrganizerDashboard() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [healthData, setHealthData] = useState(null);
  const [recentIncidents, setRecentIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch events list first
  useEffect(() => {
    api.get("/api/events/organizer/mine")
      .then((data) => {
        setEvents(data.events || []);
        if (data.events && data.events.length > 0) {
          const liveEvent = data.events.find(e => e.status === "live");
          if (liveEvent) {
            setSelectedEventId(liveEvent.id);
          } else {
            const upcomingEvent = data.events.find(e => e.status === "upcoming");
            if (upcomingEvent) {
              setSelectedEventId(upcomingEvent.id);
            } else {
              const endedEvents = data.events.filter(e => e.status === "ended");
              setSelectedEventId(endedEvents.length > 0 ? endedEvents[endedEvents.length - 1].id : data.events[0].id);
            }
          }
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        toast(err.message, "error");
        setLoading(false);
      });
  }, [toast]);

  // Fetch operational health & incidents
  const fetchHealthAndIncidents = useCallback(async () => {
    if (!selectedEventId) return;
    try {
      const [hRes, incRes] = await Promise.all([
        api.get(`/api/organizer/health/${selectedEventId}`),
        api.get(`/api/organizer/incidents/${selectedEventId}`).catch(() => ({ incidents: [] })),
      ]);

      if (hRes.health) {
        setHealthData(hRes.health);
      }
      setRecentIncidents((incRes.incidents || []).slice(0, 5));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, toast]);

  useEffect(() => {
    if (!selectedEventId) return;
    setLoading(true);
    fetchHealthAndIncidents();

    // 15s polling fallback
    const interval = setInterval(fetchHealthAndIncidents, 15000);

    // Supabase Realtime CDC subscription
    let channel = null;
    if (isSupabaseConfigured && selectedEventId) {
      channel = supabase
        .channel(`org-dashboard-${selectedEventId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "operational_incidents", filter: `event_id=eq.${selectedEventId}` },
          () => fetchHealthAndIncidents()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "crowd_zone_snapshots", filter: `event_id=eq.${selectedEventId}` },
          () => fetchHealthAndIncidents()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "volunteer_shifts", filter: `event_id=eq.${selectedEventId}` },
          () => fetchHealthAndIncidents()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tickets", filter: `event_id=eq.${selectedEventId}` },
          () => fetchHealthAndIncidents()
        )
        .subscribe();
    }

    return () => {
      clearInterval(interval);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [selectedEventId, fetchHealthAndIncidents]);

  // Derive Operational Health Status
  const getHealthStatus = () => {
    if (!healthData) return { label: "Unknown", color: "var(--text-muted)", bg: "var(--bg-tertiary)", desc: "Loading health status..." };
    
    const urgentInc = healthData.incidents?.urgent || 0;
    const activeInc = healthData.incidents?.active || 0;
    const highCapZone = healthData.zones?.some(z => {
      const cap = z.operating_capacity || 0;
      return cap > 0 && (z.active_count / cap) > 0.85;
    });

    if (urgentInc > 0 || healthData.status === "critical") {
      return {
        label: "Critical",
        color: "#EF4444",
        bg: "rgba(239, 68, 68, 0.15)",
        desc: `${urgentInc} urgent incident(s) require immediate dispatch`,
        icon: LuShieldAlert,
      };
    }
    if (highCapZone || activeInc > 0 || healthData.status === "elevated") {
      return {
        label: "Elevated",
        color: "#F59E0B",
        bg: "rgba(245, 158, 11, 0.15)",
        desc: activeInc > 0 ? `${activeInc} active incident(s) underway` : "Zone crowd density approaching capacity",
        icon: LuTriangleAlert,
      };
    }
    return {
      label: "Healthy",
      color: "#10B981",
      bg: "rgba(16, 185, 129, 0.15)",
      desc: "All zones and systems operating within normal parameters",
      icon: LuCircleCheck,
    };
  };

  const healthGauge = getHealthStatus();
  const GaugeIcon = healthGauge.icon || LuActivity;

  if (loading && !healthData) {
    return (
      <div className="loading-screen" style={{ minHeight: "60vh" }}>
        <div className="spinner"></div>
        <div style={{ marginTop: "16px", color: "var(--text-muted)" }}>Initializing Command Center...</div>
      </div>
    );
  }

  const registeredTickets = healthData?.tickets?.total || 0;
  const checkedInAttendees = healthData?.tickets?.checked_in || 0;
  const checkinRate = registeredTickets > 0 ? Math.round((checkedInAttendees / registeredTickets) * 100) : 0;

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      
      {/* PAGE HEADER */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: healthGauge.color, boxShadow: `0 0 10px ${healthGauge.color}`, animation: "pulse 2s infinite" }} />
            Executive Command
          </h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Live operational health, incidents, and crowd intelligence.
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

      {/* OPERATIONAL HEALTH GAUGE BANNER */}
      <div style={{ 
        display: "flex", 
        flexWrap: "wrap", 
        alignItems: "center", 
        justifyContent: "space-between", 
        gap: "16px",
        padding: "16px 20px", 
        borderRadius: "12px", 
        backgroundColor: "var(--bg-secondary)", 
        border: `1px solid ${healthGauge.color}40`,
        borderLeft: `6px solid ${healthGauge.color}`
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ 
            width: "44px", 
            height: "44px", 
            borderRadius: "10px", 
            backgroundColor: healthGauge.bg, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            color: healthGauge.color 
          }}>
            <GaugeIcon size={24} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.1rem", fontWeight: "700" }}>Operational Health:</span>
              <span style={{ 
                padding: "2px 10px", 
                borderRadius: "20px", 
                fontSize: "0.85rem", 
                fontWeight: "700", 
                backgroundColor: healthGauge.bg, 
                color: healthGauge.color 
              }}>
                {healthGauge.label.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
              {healthGauge.desc}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "20px", fontSize: "0.85rem" }}>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Active Incidents: </span>
            <strong style={{ color: (healthData?.incidents?.active || 0) > 0 ? "var(--error)" : "inherit" }}>
              {healthData?.incidents?.active || 0}
            </strong>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Staff on Duty: </span>
            <strong>{healthData?.shifts?.active || 0}</strong>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Check-in Rate: </span>
            <strong style={{ color: "var(--primary)" }}>{checkinRate}%</strong>
          </div>
        </div>
      </div>

      {/* LIVE INCIDENT TICKER */}
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: "12px", 
        backgroundColor: "var(--bg-secondary)", 
        padding: "10px 16px", 
        borderRadius: "8px", 
        border: "1px solid var(--border-light)",
        overflow: "hidden" 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--error)", fontWeight: "700", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
          <LuRadio size={14} className="ble-radius-pulse" /> Live Incidents:
        </div>
        
        {recentIncidents.length === 0 ? (
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Zero active incidents reported &bull; Normal operating conditions
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "16px", overflowX: "auto", whiteSpace: "nowrap", flex: 1, paddingBottom: "2px" }}>
            {recentIncidents.map(inc => {
              const isUrgent = inc.priority === "urgent" || inc.priority === "critical";
              return (
                <Link
                  key={inc.id}
                  to="/organizer/incidents"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "0.85rem",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    backgroundColor: isUrgent ? "rgba(239, 68, 68, 0.15)" : "var(--bg-tertiary)",
                    color: isUrgent ? "#EF4444" : "var(--text-primary)",
                    textDecoration: "none",
                    border: `1px solid ${isUrgent ? "rgba(239, 68, 68, 0.3)" : "var(--border-light)"}`
                  }}
                >
                  <span style={{ 
                    fontSize: "0.7rem", 
                    fontWeight: "800", 
                    padding: "1px 6px", 
                    borderRadius: "4px", 
                    backgroundColor: isUrgent ? "#EF4444" : "var(--info)", 
                    color: "#fff" 
                  }}>
                    {inc.priority?.toUpperCase()}
                  </span>
                  <span style={{ fontWeight: "600" }}>{inc.title}</span>
                  {inc.zone_name && (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                      ({inc.zone_name})
                    </span>
                  )}
                  <LuChevronRight size={12} />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {!healthData ? (
        <div className="empty-state">
          <div className="empty-state-icon"><LuActivity /></div>
          <div className="empty-state-title">No operational data</div>
          <div className="empty-state-text">
            Start your event to begin tracking operational health.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* TOP KPI ROW (TICKET-BASED REGISTERED VS CHECKED-IN) */}
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat-card" style={{ borderLeft: "4px solid var(--error)" }}>
              <div className="stat-icon" style={{ color: "var(--error)" }}><LuShieldAlert /></div>
              <div>
                <div className="stat-value" style={{ color: "var(--error)" }}>{healthData.incidents?.active || 0}</div>
                <div className="stat-label">Active Incidents</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  {healthData.incidents?.urgent || 0} urgent &middot; {healthData.incidents?.resolved || 0} resolved
                </div>
              </div>
            </div>
            
            <div className="stat-card" style={{ borderLeft: "4px solid var(--info)" }}>
              <div className="stat-icon info"><LuUsers /></div>
              <div>
                <div className="stat-value">{healthData.shifts?.active || 0}</div>
                <div className="stat-label">Active Staff</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  {healthData.shifts?.on_break || 0} on break &middot; {healthData.coverage?.pending || 0} requests
                </div>
              </div>
            </div>

            {/* TICKET-BASED ATTENDANCE KPI */}
            <div className="stat-card" style={{ borderLeft: "4px solid var(--primary)" }}>
              <div className="stat-icon primary"><LuTicket /></div>
              <div>
                <div className="stat-value">{checkedInAttendees}</div>
                <div className="stat-label">Checked-In Attendees</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  {registeredTickets} registered &middot; {checkinRate}% turnout
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ borderLeft: "4px solid var(--success)" }}>
              <div className="stat-icon success"><LuCircleCheck /></div>
              <div>
                <div className="stat-value">{healthData.tasks?.completed || 0}</div>
                <div className="stat-label">Tasks Completed</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  {healthData.tasks?.pending || 0} pending &middot; {healthData.tasks?.in_progress || 0} active
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
            
            {/* ZONE STATUS BOARD */}
            <div className="card">
              <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <LuMapPin /> Venue Zone Status
                </h3>
                <Link to="/organizer/map" className="btn btn-ghost btn-sm">Full Map</Link>
              </div>
              <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {healthData.zones?.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "20px" }}>No zones configured</div>
                ) : (
                  healthData.zones?.slice(0, 6).map((zone, idx) => {
                    const capacity = zone.operating_capacity || 100;
                    const ratio = capacity > 0 ? (zone.active_count || 0) / capacity : 0;
                    const isHigh = ratio > 0.85;
                    
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", borderLeft: isHigh ? "3px solid var(--error)" : "3px solid var(--success)" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: "600", fontSize: "0.95rem" }}>{zone.zone_name}</div>
                          <div style={{ display: "flex", gap: "16px", fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <LuUsers size={12} /> {zone.active_staff || 0} Staff
                            </span>
                            {zone.active_incidents > 0 && (
                              <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--error)" }}>
                                <LuTriangleAlert size={12} /> {zone.active_incidents} Incidents
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "1.2rem", fontWeight: "700", color: isHigh ? "var(--error)" : "var(--text-primary)" }}>
                            {zone.active_count || 0}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {capacity > 0 ? `${Math.round(ratio * 100)}% capacity` : "people"}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* QUICK ACTIONS & COMMS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Quick Dispatch</h3>
                </div>
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <Link to="/organizer/incidents" className="btn btn-outline" style={{ justifyContent: "center", borderColor: "var(--error)", color: "var(--error)" }}>
                    <LuShieldAlert size={16} /> Report Emergency
                  </Link>
                  <Link to="/organizer/comms" className="btn btn-outline" style={{ justifyContent: "center", borderColor: "var(--info)", color: "var(--info)" }}>
                    <LuMessageSquare size={16} /> Broadcast Message
                  </Link>
                  <Link to="/organizer/tasks" className="btn btn-outline" style={{ justifyContent: "center" }}>
                    <LuCircleCheck size={16} /> Assign Task
                  </Link>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Communications</h3>
                </div>
                <div style={{ padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Total Sent</span>
                    <span style={{ fontWeight: "600" }}>{healthData.communications?.total_messages || 0}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Broadcasts</span>
                    <span style={{ fontWeight: "600" }}>{healthData.communications?.broadcasts || 0}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Urgent</span>
                    <span style={{ fontWeight: "600", color: "var(--error)" }}>{healthData.communications?.urgent || 0}</span>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
