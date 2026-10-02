import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { 
  LuUsers, 
  LuUser, 
  LuClock, 
  LuMapPin, 
  LuCircleCheck, 
  LuTriangleAlert,
  LuShieldAlert,
  LuCheck,
  LuSend
} from "react-icons/lu";

export default function OrganizerAssistance() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // Resolution modal
  const [resolvingReq, setResolvingReq] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolving, setResolving] = useState(false);

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

  const fetchRequests = useCallback(() => {
    if (!selectedEventId) return;
    setLoading(true);
    api.get(`/api/organizer/assistance/${selectedEventId}`)
      .then((data) => setRequests(data.assistance_requests || []))
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Escalate request to urgent operational incident
  const handleEscalate = async (reqId, reqTitle) => {
    if (!window.confirm(`Escalate "${reqTitle}" to an Urgent Operational Incident?`)) return;
    try {
      await api.post(`/api/organizer/assistance/${reqId}/escalate`, {
        reason: "Escalated by organizer triage desk",
      });
      toast("Assistance request escalated to Urgent Incident!", "success");
      fetchRequests();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Resolve request
  const handleResolveSubmit = async (e) => {
    e.preventDefault();
    if (!resolvingReq) return;
    setResolving(true);
    try {
      await api.put(`/api/organizer/incidents/${resolvingReq.id}`, {
        status: "resolved",
        resolution_notes: resolutionNotes || "Assistance provided to attendee",
      });
      toast("Assistance request resolved successfully", "success");
      setResolvingReq(null);
      setResolutionNotes("");
      fetchRequests();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setResolving(false);
    }
  };

  const getStatusBadge = (status) => {
    switch(status) {
      case "reported": return <span className="badge" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}>Pending</span>;
      case "acknowledged": return <span className="badge warning">Acknowledged</span>;
      case "assigned": return <span className="badge info">Assigned</span>;
      case "in_progress": return <span className="badge info">Assisting</span>;
      case "resolved": return <span className="badge success">Resolved</span>;
      case "closed": return <span className="badge" style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}>Closed</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case "urgent":
      case "critical": return "var(--error)";
      case "important":
      case "elevated": return "var(--warning)";
      default: return "var(--info)";
    }
  };

  const pendingCount = requests.filter(r => !["resolved", "closed"].includes(r.status)).length;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Attendee Assistance Desk</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Triage attendee help requests, ADA assistance, and lost-and-found escalations.
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

      <div className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="card-title">Live Assistance Queue</h3>
          <span className={`badge ${pendingCount > 0 ? "warning" : "success"}`}>
            {pendingCount} Active Request(s)
          </span>
        </div>
        
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center" }}>
            <div className="spinner"></div>
          </div>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><LuCircleCheck color="var(--success)" /></div>
            <div className="empty-state-title">No pending requests</div>
            <div className="empty-state-text">
              There are no attendee assistance requests for this event.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request Details</th>
                  <th>Status</th>
                  <th>Location / Zone</th>
                  <th>Requested At</th>
                  <th>Assigned Staff</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const isResolved = ["resolved", "closed"].includes(req.status);

                  return (
                    <tr key={req.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                          <div style={{ 
                            width: "10px", 
                            height: "10px", 
                            borderRadius: "50%", 
                            backgroundColor: getPriorityColor(req.priority),
                            marginTop: "6px"
                          }} />
                          <div>
                            <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>{req.title}</div>
                            {req.description && (
                              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px" }}>
                                {req.description}
                              </div>
                            )}
                            {req.location_description && (
                              <div style={{ fontSize: "0.75rem", color: "var(--info)", marginTop: "2px" }}>
                                Pin: {req.location_description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{getStatusBadge(req.status)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                          <LuMapPin size={14} color="var(--primary)" />
                          <strong>{req.zone_name || req.venue_zone_name || "Zone"}</strong>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                          <LuClock size={14} />
                          {req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                        </div>
                      </td>
                      <td>
                        {req.assigned_to ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                            <LuUser size={14} />
                            <strong>{req.assigned_to_name || req.assigned_to.substring(0, 8)}</strong>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Unassigned</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {!isResolved && (
                            <button 
                              className="btn btn-sm btn-outline"
                              onClick={() => handleEscalate(req.id, req.title)}
                              style={{ borderColor: "rgba(239, 68, 68, 0.4)", color: "var(--error)", fontSize: "0.75rem" }}
                              title="Escalate to Urgent Incident"
                            >
                              <LuShieldAlert size={12} /> Escalate
                            </button>
                          )}
                          {!isResolved && (
                            <button 
                              className="btn btn-sm btn-primary"
                              onClick={() => setResolvingReq(req)}
                              style={{ fontSize: "0.75rem" }}
                              title="Mark as Resolved"
                            >
                              <LuCheck size={12} /> Resolve
                            </button>
                          )}
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

      {/* RESOLUTION MODAL */}
      {resolvingReq && (
        <div className="modal-backdrop fade-in" onClick={() => setResolvingReq(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "440px" }}>
            <div className="modal-header">
              <h3>Resolve Assistance Request</h3>
              <button className="btn btn-ghost" onClick={() => setResolvingReq(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "14px" }}>
                Resolving request: <strong>{resolvingReq.title}</strong>
              </p>
              <form onSubmit={handleResolveSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="form-group">
                  <label className="form-label">Resolution Notes</label>
                  <textarea
                    className="form-textarea"
                    placeholder="e.g. Volunteer guided attendee to ADA ramp, wheel chair provided."
                    value={resolutionNotes}
                    onChange={e => setResolutionNotes(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setResolvingReq(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={resolving}>
                    {resolving ? "Resolving..." : "Confirm Resolved"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
