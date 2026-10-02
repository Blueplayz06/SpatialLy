import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { supabase, isSupabaseConfigured } from "../utils/supabaseClient";
import { 
  LuPlus, 
  LuCircleCheck, 
  LuClock, 
  LuMapPin, 
  LuUser,
  LuShieldAlert,
  LuHistory,
  LuSend,
  LuImage,
  LuCheck
} from "react-icons/lu";

export default function OrganizerIncidents() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [incidents, setIncidents] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  // Create Incident Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newIncident, setNewIncident] = useState({
    title: "",
    description: "",
    category: "medical",
    priority: "urgent",
    zone_name: "",
  });

  // Assign / Dispatch Modal
  const [dispatchIncident, setDispatchIncident] = useState(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [dispatchNotes, setDispatchNotes] = useState("");
  const [dispatching, setDispatching] = useState(false);

  // Audit Logs Drawer / Modal
  const [auditIncident, setAuditIncident] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Photo viewer modal
  const [previewPhoto, setPreviewPhoto] = useState(null);

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

  const fetchIncidents = useCallback(() => {
    if (!selectedEventId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/organizer/incidents/${selectedEventId}`),
      api.get(`/api/organizer/volunteers/${selectedEventId}`).catch(() => ({ assignments: [] })),
      api.get(`/api/organizer/zones/${selectedEventId}`).catch(() => ({ zones: [] })),
    ])
      .then(([incData, volData, zData]) => {
        setIncidents(incData.incidents || []);
        setVolunteers(volData.assignments || []);
        setZones(zData.zones || []);
      })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchIncidents();

    // Supabase Realtime CDC on operational_incidents
    let channel = null;
    if (isSupabaseConfigured && selectedEventId) {
      channel = supabase
        .channel(`org-incidents-${selectedEventId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "operational_incidents", filter: `event_id=eq.${selectedEventId}` },
          () => fetchIncidents()
        )
        .subscribe();
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [selectedEventId, fetchIncidents]);

  // Handle Create
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/api/organizer/incidents", {
        ...newIncident,
        event_id: selectedEventId,
      });
      toast("Incident reported and logged", "success");
      setIsCreateOpen(false);
      setNewIncident({ title: "", description: "", category: "medical", priority: "urgent", zone_name: "" });
      fetchIncidents();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Handle Atomic Dispatch Assign
  const handleDispatchSubmit = async (e) => {
    e.preventDefault();
    if (!assigneeId) {
      toast("Please select a volunteer", "warning");
      return;
    }
    setDispatching(true);
    try {
      await api.post(`/api/organizer/incidents/${dispatchIncident.id}/assign`, {
        assigned_to: assigneeId,
        notes: dispatchNotes || undefined,
      });
      toast("Incident dispatched and assigned!", "success");
      setDispatchIncident(null);
      setAssigneeId("");
      setDispatchNotes("");
      fetchIncidents();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setDispatching(false);
    }
  };

  // Open Audit Log
  const handleOpenAudit = async (inc) => {
    setAuditIncident(inc);
    setLoadingAudit(true);
    try {
      const res = await api.get(`/api/organizer/incident-logs/${inc.id}`);
      setAuditLogs(res.logs || []);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  // Quick Resolve
  const handleQuickResolve = async (incId) => {
    try {
      await api.put(`/api/organizer/incidents/${incId}`, {
        status: "resolved",
        resolution_notes: "Resolved by executive command",
      });
      toast("Incident marked as resolved", "success");
      fetchIncidents();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const filteredIncidents = incidents.filter(inc => {
    if (filter === "active") return ["reported", "acknowledged", "assigned", "in_progress"].includes(inc.status);
    if (filter === "resolved") return ["resolved", "closed"].includes(inc.status);
    return true;
  });

  const getPriorityColor = (priority) => {
    switch(priority) {
      case "urgent":
      case "critical": return "var(--error)";
      case "elevated":
      case "important": return "var(--warning)";
      default: return "var(--info)";
    }
  };

  const getStatusBadge = (status) => {
    switch(status) {
      case "reported": return <span className="badge" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}>Reported</span>;
      case "acknowledged": return <span className="badge warning">Acknowledged</span>;
      case "assigned": return <span className="badge info">Assigned</span>;
      case "in_progress": return <span className="badge info">In Progress</span>;
      case "resolved": return <span className="badge success">Resolved</span>;
      case "closed": return <span className="badge" style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}>Closed</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Incident Command Center</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Real-time emergency triage, atomic team dispatch, and audit trails.
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
          <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)}>
            <LuPlus size={16} /> Log Incident
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "16px", padding: "16px", borderBottom: "1px solid var(--border-light)" }}>
          <button 
            className={`btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("all")}
          >
            All Incidents ({incidents.length})
          </button>
          <button 
            className={`btn btn-sm ${filter === "active" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("active")}
          >
            Active ({incidents.filter(i => !["resolved", "closed"].includes(i.status)).length})
          </button>
          <button 
            className={`btn btn-sm ${filter === "resolved" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("resolved")}
          >
            Resolved ({incidents.filter(i => ["resolved", "closed"].includes(i.status)).length})
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center" }}><div className="spinner"></div></div>
        ) : filteredIncidents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><LuCircleCheck color="var(--success)" /></div>
            <div className="empty-state-title">No incidents match this filter</div>
            <div className="empty-state-text">
              The operational zone is clear.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Priority & Status</th>
                  <th>Zone Sector</th>
                  <th>Reported Time</th>
                  <th>Assigned Staff</th>
                  <th>Evidence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncidents.map(inc => {
                  const isResolved = ["resolved", "closed"].includes(inc.status);
                  const evidenceList = inc.evidence_urls || [];

                  return (
                    <tr key={inc.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                          <div style={{ 
                            width: "10px", 
                            height: "10px", 
                            borderRadius: "50%", 
                            backgroundColor: getPriorityColor(inc.priority),
                            marginTop: "6px"
                          }} />
                          <div>
                            <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>{inc.title}</div>
                            {inc.description && (
                              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px" }}>
                                {inc.description}
                              </div>
                            )}
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                              Category: {inc.category?.toUpperCase()}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ 
                            fontSize: "0.7rem", 
                            fontWeight: "800", 
                            color: getPriorityColor(inc.priority),
                            textTransform: "uppercase" 
                          }}>
                            {inc.priority}
                          </span>
                          {getStatusBadge(inc.status)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem" }}>
                          <LuMapPin size={14} color="var(--primary)" />
                          <strong>{inc.zone_name || inc.venue_zone_name || "Unassigned"}</strong>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          <LuClock size={14} />
                          {inc.created_at ? new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                        </div>
                      </td>
                      <td>
                        {inc.assigned_to ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", color: "var(--text-primary)" }}>
                            <LuUser size={14} />
                            <strong>{inc.assigned_to_name || inc.assigned_to.substring(0, 8)}</strong>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Unassigned</span>
                        )}
                      </td>
                      <td>
                        {evidenceList.length > 0 ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => setPreviewPhoto(evidenceList[0])}
                            title="View Evidence Photo"
                            style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem" }}
                          >
                            <LuImage size={14} color="var(--info)" />
                            {evidenceList.length} photo(s)
                          </button>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>None</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {!isResolved && (
                            <button 
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setDispatchIncident(inc);
                                setAssigneeId(inc.assigned_to || "");
                              }}
                              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            >
                              <LuSend size={12} /> Dispatch
                            </button>
                          )}
                          {!isResolved && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleQuickResolve(inc.id)}
                              style={{ borderColor: "var(--success)", color: "var(--success)" }}
                              title="Resolve Incident"
                            >
                              <LuCheck size={12} />
                            </button>
                          )}
                          <button 
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleOpenAudit(inc)}
                            title="View Audit Trail"
                          >
                            <LuHistory size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE INCIDENT MODAL */}
      {isCreateOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3>Report Emergency Incident</h3>
              <button className="btn btn-ghost" onClick={() => setIsCreateOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="form-group">
                  <label className="form-label">Incident Title *</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Overcrowded Stairwell / Medical Slip"
                    value={newIncident.title}
                    onChange={e => setNewIncident({...newIncident, title: e.target.value})}
                    required 
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select
                      className="form-select"
                      value={newIncident.category}
                      onChange={e => setNewIncident({...newIncident, category: e.target.value})}
                    >
                      <option value="medical">Medical</option>
                      <option value="security">Security</option>
                      <option value="crowd_control">Crowd Control</option>
                      <option value="facilities">Facilities / Hazard</option>
                      <option value="lost_child">Lost Person</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select
                      className="form-select"
                      value={newIncident.priority}
                      onChange={e => setNewIncident({...newIncident, priority: e.target.value})}
                    >
                      <option value="critical">Critical (Immediate Hazard)</option>
                      <option value="urgent">Urgent</option>
                      <option value="elevated">Elevated</option>
                      <option value="routine">Routine</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Sector / Zone</label>
                  <select
                    className="form-select"
                    value={newIncident.zone_name}
                    onChange={e => setNewIncident({...newIncident, zone_name: e.target.value})}
                  >
                    <option value="">-- Select Zone --</option>
                    {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Incident Details</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Describe scene, triage notes, required equipment..."
                    value={newIncident.description}
                    onChange={e => setNewIncident({...newIncident, description: e.target.value})}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsCreateOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Submit Report</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ATOMIC DISPATCH MODAL */}
      {dispatchIncident && (
        <div className="modal-backdrop fade-in" onClick={() => setDispatchIncident(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3>Dispatch Staff to Incident</h3>
              <button className="btn btn-ghost" onClick={() => setDispatchIncident(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ background: "var(--bg-secondary)", padding: "12px", borderRadius: "8px", marginBottom: "14px" }}>
                <strong style={{ color: "var(--text-primary)" }}>{dispatchIncident.title}</strong>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Zone: {dispatchIncident.zone_name || "Unknown"} &middot; Priority: {dispatchIncident.priority}
                </div>
              </div>

              <form onSubmit={handleDispatchSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="form-group">
                  <label className="form-label">Select Volunteer / Staff *</label>
                  <select
                    className="form-select"
                    value={assigneeId}
                    onChange={e => setAssigneeId(e.target.value)}
                    required
                  >
                    <option value="">-- Choose Staff to Dispatch --</option>
                    {volunteers.map(v => (
                      <option key={v.id} value={v.volunteer_id}>
                        {v.volunteer?.full_name || v.volunteer_id} ({v.role || "Volunteer"})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Dispatch Directives / Instructions</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Specify action plan, contact channel, radio frequency..."
                    value={dispatchNotes}
                    onChange={e => setDispatchNotes(e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setDispatchIncident(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={dispatching}>
                    {dispatching ? "Dispatching..." : "Confirm & Dispatch"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT LOG DRAWER MODAL */}
      {auditIncident && (
        <div className="modal-backdrop fade-in" onClick={() => setAuditIncident(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <LuHistory /> Incident Audit Log
              </h3>
              <button className="btn btn-ghost" onClick={() => setAuditIncident(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: "16px" }}>
                <h4>{auditIncident.title}</h4>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  ID: {auditIncident.id} &middot; Created {new Date(auditIncident.created_at).toLocaleString()}
                </div>
              </div>

              {loadingAudit ? (
                <div style={{ padding: "30px", textAlign: "center" }}><div className="spinner"></div></div>
              ) : auditLogs.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "16px", textAlign: "center" }}>
                  No historical log transitions recorded yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "360px", overflowY: "auto" }}>
                  {auditLogs.map((log, idx) => (
                    <div key={log.id || idx} style={{ background: "var(--bg-secondary)", padding: "10px 14px", borderRadius: "8px", borderLeft: "3px solid var(--primary)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        <span>Action: {log.action_type || log.event || "Update"}</span>
                        <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ fontSize: "0.85rem", fontWeight: "600", marginTop: "4px" }}>
                        {log.notes || log.description || `Status transitioned to ${log.new_status || log.status}`}
                      </div>
                      {log.actor?.full_name && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                          By: {log.actor.full_name}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PHOTO EVIDENCE VIEWER */}
      {previewPhoto && (
        <div className="modal-backdrop fade-in" onClick={() => setPreviewPhoto(null)} style={{ background: "rgba(0,0,0,0.85)" }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "600px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
              <h4>Incident Evidence Photo</h4>
              <button className="btn btn-ghost" onClick={() => setPreviewPhoto(null)}>&times;</button>
            </div>
            <img src={previewPhoto} alt="Evidence" style={{ width: "100%", borderRadius: "8px", objectFit: "contain", maxHeight: "400px" }} />
          </div>
        </div>
      )}

    </div>
  );
}
