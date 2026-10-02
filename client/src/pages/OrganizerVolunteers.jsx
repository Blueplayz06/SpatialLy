import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { supabase, isSupabaseConfigured } from "../utils/supabaseClient";
import { 
  LuUsers, 
  LuUserPlus, 
  LuShield, 
  LuClock, 
  LuMapPin, 
  LuCheck, 
  LuX, 
  LuCoffee,
  LuPlus,
  LuTrash2,
  LuCalendar,
  LuRepeat,
  LuBadgeCheck
} from "react-icons/lu";
import { Link } from "react-router-dom";

export default function OrganizerVolunteers() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeTab, setActiveTab] = useState("roster"); // 'roster' | 'teams' | 'coverage' | 'handoffs'
  
  // Data states
  const [shifts, setShifts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [coverageRequests, setCoverageRequests] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [newTeam, setNewTeam] = useState({ name: "", description: "", zone_name: "" });
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [newShift, setNewShift] = useState({ volunteer_id: "", shift_name: "Operations Shift", scheduled_start: "", scheduled_end: "", zone_name: "" });

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

  const fetchData = useCallback(() => {
    if (!selectedEventId) return;
    setLoading(true);

    Promise.all([
      api.get(`/api/organizer/volunteers/${selectedEventId}`),
      api.get(`/api/organizer/teams/${selectedEventId}`).catch(() => ({ teams: [] })),
      api.get(`/api/organizer/coverage/${selectedEventId}`).catch(() => ({ requests: [] })),
      api.get(`/api/organizer/handoffs/${selectedEventId}`).catch(() => ({ handoffs: [] })),
      api.get(`/api/organizer/zones/${selectedEventId}`).catch(() => ({ zones: [] })),
    ])
      .then(([volData, teamData, covData, handData, zoneData]) => {
        setAssignments(volData.assignments || []);
        setShifts(volData.shifts || []);
        setTeams(teamData.teams || []);
        setCoverageRequests(covData.requests || []);
        setHandoffs(handData.handoffs || []);
        setZones(zoneData.zones || []);
      })
      .catch(err => {
        toast(err.message, "error");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchData();

    // Supabase Realtime CDC on volunteer_shifts & coverage_requests
    let channel = null;
    if (isSupabaseConfigured && selectedEventId) {
      channel = supabase
        .channel(`org-volunteers-${selectedEventId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "volunteer_shifts", filter: `event_id=eq.${selectedEventId}` }, () => fetchData())
        .on("postgres_changes", { event: "*", schema: "public", table: "coverage_requests", filter: `event_id=eq.${selectedEventId}` }, () => fetchData())
        .subscribe();
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [selectedEventId, fetchData]);

  // Team Actions
  const handleCreateTeam = async (e) => {
    e.preventDefault();
    try {
      await api.post("/api/organizer/teams", {
        ...newTeam,
        event_id: selectedEventId,
      });
      toast("Team created successfully", "success");
      setIsTeamModalOpen(false);
      setNewTeam({ name: "", description: "", zone_name: "" });
      fetchData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const handleDeleteTeam = async (teamId, teamName) => {
    if (!window.confirm(`Delete squad "${teamName}"?`)) return;
    try {
      await api.delete(`/api/organizer/teams/${teamId}`);
      toast("Team deleted", "success");
      fetchData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Shift Actions
  const handleCreateShift = async (e) => {
    e.preventDefault();
    try {
      await api.post("/api/organizer/shifts", {
        ...newShift,
        event_id: selectedEventId,
      });
      toast("Shift scheduled successfully", "success");
      setIsShiftModalOpen(false);
      setNewShift({ volunteer_id: "", shift_name: "Operations Shift", scheduled_start: "", scheduled_end: "", zone_name: "" });
      fetchData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const handleDeleteShift = async (shiftId) => {
    if (!window.confirm("Cancel this scheduled shift?")) return;
    try {
      await api.delete(`/api/organizer/shifts/${shiftId}`);
      toast("Shift removed", "success");
      fetchData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Approve Coverage
  const handleApproveCoverage = async (covId) => {
    try {
      await api.put(`/api/organizer/coverage/${covId}/approve`);
      toast("Coverage relief request approved", "success");
      fetchData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const activeShifts = shifts.filter(s => s.status === "active");
  const onBreakShifts = shifts.filter(s => s.break_state === "taking_break" || s.break_state === "on_break");
  const pendingCoverage = coverageRequests.filter(c => c.status === "pending");

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Staff Operations & Squad Command</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Monitor active coverage, shift handoffs, relief rotations, and teams.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
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
          <Link to="/organizer/invite" className="btn btn-primary">
            <LuUserPlus size={16} /> Invite Staff
          </Link>
        </div>
      </div>

      {/* KPI STATS BAR */}
      <div className="stats-grid" style={{ marginBottom: "20px" }}>
        <div className="stat-card">
          <div className="stat-icon info"><LuUsers /></div>
          <div>
            <div className="stat-value">{assignments.length}</div>
            <div className="stat-label">Assigned Staff</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><LuShield /></div>
          <div>
            <div className="stat-value">{activeShifts.length}</div>
            <div className="stat-label">Active on Duty</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon warning"><LuCoffee /></div>
          <div>
            <div className="stat-value">{onBreakShifts.length}</div>
            <div className="stat-label">On Break / Relief</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ color: pendingCoverage.length > 0 ? "var(--error)" : "var(--success)" }}><LuRepeat /></div>
          <div>
            <div className="stat-value" style={{ color: pendingCoverage.length > 0 ? "var(--error)" : "inherit" }}>
              {pendingCoverage.length}
            </div>
            <div className="stat-label">Coverage Requests</div>
          </div>
        </div>
      </div>

      {/* SUB-NAVIGATION TABS */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", borderBottom: "1px solid var(--border-light)", paddingBottom: "10px" }}>
        <button 
          className={`btn btn-sm ${activeTab === "roster" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("roster")}
        >
          <LuUsers size={14} /> Duty Roster & Shifts ({shifts.length})
        </button>
        <button 
          className={`btn btn-sm ${activeTab === "teams" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("teams")}
        >
          <LuShield size={14} /> Squad Teams ({teams.length})
        </button>
        <button 
          className={`btn btn-sm ${activeTab === "coverage" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("coverage")}
        >
          <LuCoffee size={14} /> Relief & Coverage ({pendingCoverage.length} Pending)
        </button>
        <button 
          className={`btn btn-sm ${activeTab === "handoffs" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("handoffs")}
        >
          <LuRepeat size={14} /> Shift Handoff Logs ({handoffs.length})
        </button>
      </div>

      {/* TAB CONTENT */}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center" }}><div className="spinner"></div></div>
      ) : activeTab === "roster" ? (
        /* ROSTER & SHIFTS TAB */
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">Live Duty Roster</h3>
            <button className="btn btn-sm btn-primary" onClick={() => setIsShiftModalOpen(true)}>
              <LuPlus size={14} /> Schedule Shift
            </button>
          </div>

          {shifts.length === 0 && assignments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuUsers /></div>
              <div className="empty-state-title">No staff assigned</div>
              <div className="empty-state-text">
                Invite volunteers to this event to assign them shifts and zones.
              </div>
              <Link to="/organizer/invite" className="btn btn-primary" style={{ marginTop: "16px" }}>
                <LuUserPlus size={16} /> Go to Invitations
              </Link>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Volunteer</th>
                    <th>Role / Assignment</th>
                    <th>Zone</th>
                    <th>Shift Hours</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map(shift => {
                    const assignMatch = assignments.find(a => a.volunteer_id === shift.volunteer_id);
                    const volName = assignMatch?.volunteer?.full_name || shift.volunteer_id?.slice(0, 8);
                    const isBreak = shift.break_state === "taking_break" || shift.break_state === "on_break";

                    return (
                      <tr key={shift.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div className="avatar" style={{ width: "32px", height: "32px", fontSize: "0.8rem" }}>
                              {volName?.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>{volName}</div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>ID: {shift.volunteer_id?.slice(0, 8)}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                            {shift.shift_name || assignMatch?.role || "General Volunteer"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem" }}>
                            <LuMapPin size={14} color="var(--primary)" />
                            <strong>{shift.zone_name || "Floating"}</strong>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            {shift.scheduled_start ? new Date(shift.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                            {" – "}
                            {shift.scheduled_end ? new Date(shift.scheduled_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                          </div>
                        </td>
                        <td>
                          {isBreak ? (
                            <span className="badge warning" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <LuCoffee size={12} /> Taking Break
                            </span>
                          ) : shift.status === "active" ? (
                            <span className="badge success">On Duty</span>
                          ) : (
                            <span className="badge">{shift.status}</span>
                          )}
                        </td>
                        <td>
                          <button 
                            className="btn btn-ghost btn-sm" 
                            onClick={() => handleDeleteShift(shift.id)}
                            style={{ color: "var(--error)" }}
                            title="Cancel Shift"
                          >
                            <LuTrash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : activeTab === "teams" ? (
        /* TEAMS & SQUADS TAB */
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">Event Squads & Special Teams</h3>
            <button className="btn btn-sm btn-primary" onClick={() => setIsTeamModalOpen(true)}>
              <LuPlus size={14} /> Create Squad
            </button>
          </div>

          {teams.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuShield /></div>
              <div className="empty-state-title">No Squads Created</div>
              <div className="empty-state-text">
                Group volunteers into squads (e.g. Medical Response, Gate Control, Ushering).
              </div>
              <button className="btn btn-primary" style={{ marginTop: "16px" }} onClick={() => setIsTeamModalOpen(true)}>
                <LuPlus size={16} /> Create First Squad
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px", padding: "16px" }}>
              {teams.map(t => (
                <div key={t.id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-light)", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <h4 style={{ fontWeight: "700", fontSize: "1rem" }}>{t.name}</h4>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteTeam(t.id, t.name)} style={{ color: "var(--error)" }}>
                      <LuTrash2 size={14} />
                    </button>
                  </div>
                  {t.description && (
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "12px", flex: 1 }}>
                      {t.description}
                    </p>
                  )}
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <LuMapPin size={14} />
                    <span>Sector: {t.zone_name || "All Zones"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === "coverage" ? (
        /* COVERAGE & RELIEF TAB */
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Break Relief & Coverage Requests</h3>
          </div>

          {coverageRequests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuBadgeCheck color="var(--success)" /></div>
              <div className="empty-state-title">All Zones Adequately Covered</div>
              <div className="empty-state-text">
                No active staff have pending break or relief coverage requests.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Requester</th>
                    <th>Zone</th>
                    <th>Reason / Notes</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageRequests.map(cov => (
                    <tr key={cov.id}>
                      <td>
                        <strong style={{ color: "var(--text-primary)" }}>{cov.requester_name || cov.requester_id?.slice(0, 8)}</strong>
                      </td>
                      <td>{cov.zone_name || "Unspecified"}</td>
                      <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{cov.notes || "Relief requested"}</td>
                      <td>
                        <span className={`badge ${cov.status === "pending" ? "warning" : "success"}`}>
                          {cov.status}
                        </span>
                      </td>
                      <td>
                        {cov.status === "pending" && (
                          <button 
                            className="btn btn-sm btn-primary"
                            onClick={() => handleApproveCoverage(cov.id)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          >
                            <LuCheck size={14} /> Approve & Dispatch
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* SHIFT HANDOFFS TAB */
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Shift Handoff Logs</h3>
          </div>

          {handoffs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuRepeat /></div>
              <div className="empty-state-title">No Handoff Logs Recorded</div>
              <div className="empty-state-text">
                Shift handoff notes submitted between incoming and outgoing volunteers will appear here.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Outgoing Volunteer</th>
                    <th>Incoming Volunteer</th>
                    <th>Zone</th>
                    <th>Handoff Notes</th>
                    <th>Logged At</th>
                  </tr>
                </thead>
                <tbody>
                  {handoffs.map(h => (
                    <tr key={h.id}>
                      <td>{h.outgoing_name || h.outgoing_volunteer_id?.slice(0, 8)}</td>
                      <td>{h.incoming_name || h.incoming_volunteer_id?.slice(0, 8)}</td>
                      <td><strong>{h.zone_name || "Zone"}</strong></td>
                      <td style={{ fontSize: "0.85rem" }}>{h.notes || "Handoff complete"}</td>
                      <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        {h.created_at ? new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATE TEAM MODAL */}
      {isTeamModalOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsTeamModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3>Create Volunteer Squad</h3>
              <button className="btn btn-ghost" onClick={() => setIsTeamModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateTeam} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="form-group">
                  <label className="form-label">Squad / Team Name *</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Rapid Medical Squad"
                    value={newTeam.name}
                    onChange={e => setNewTeam({...newTeam, name: e.target.value})}
                    required 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Sector / Primary Zone</label>
                  <select 
                    className="form-select"
                    value={newTeam.zone_name}
                    onChange={e => setNewTeam({...newTeam, zone_name: e.target.value})}
                  >
                    <option value="">-- All Zones (Floating) --</option>
                    {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Responsibilities & Description</label>
                  <textarea 
                    className="form-textarea" 
                    placeholder="Describe mission, equipment, protocols..."
                    value={newTeam.description}
                    onChange={e => setNewTeam({...newTeam, description: e.target.value})}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsTeamModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Create Squad</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE SHIFT MODAL */}
      {isShiftModalOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsShiftModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3>Schedule Volunteer Shift</h3>
              <button className="btn btn-ghost" onClick={() => setIsShiftModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateShift} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="form-group">
                  <label className="form-label">Assign Volunteer *</label>
                  <select 
                    className="form-select"
                    value={newShift.volunteer_id}
                    onChange={e => setNewShift({...newShift, volunteer_id: e.target.value})}
                    required
                  >
                    <option value="">-- Select Volunteer --</option>
                    {assignments.map(a => (
                      <option key={a.id} value={a.volunteer_id}>
                        {a.volunteer?.full_name || a.volunteer_id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Shift Title</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Morning Usher Shift"
                    value={newShift.shift_name}
                    onChange={e => setNewShift({...newShift, shift_name: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Assigned Zone</label>
                  <select 
                    className="form-select"
                    value={newShift.zone_name}
                    onChange={e => setNewShift({...newShift, zone_name: e.target.value})}
                  >
                    <option value="">-- Floating / Unassigned --</option>
                    {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Start Time *</label>
                    <input 
                      type="datetime-local" 
                      className="form-input" 
                      value={newShift.scheduled_start}
                      onChange={e => setNewShift({...newShift, scheduled_start: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Time *</label>
                    <input 
                      type="datetime-local" 
                      className="form-input" 
                      value={newShift.scheduled_end}
                      onChange={e => setNewShift({...newShift, scheduled_end: e.target.value})}
                      required
                    />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsShiftModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Schedule Shift</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
