import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { 
  LuCalendarPlus, 
  LuStore, 
  LuPlus, 
  LuPencil, 
  LuTrash2, 
  LuMapPin, 
  LuClock, 
  LuTrophy,
  LuSparkles
} from "react-icons/lu";

export default function OrganizerContent() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeTab, setActiveTab] = useState("booths"); // 'booths' | 'sessions' | 'activities'
  
  // Data states
  const [booths, setBooths] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activities, setActivities] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isBoothModalOpen, setIsBoothModalOpen] = useState(false);
  const [editingBooth, setEditingBooth] = useState(null);
  const [boothForm, setBoothForm] = useState({ name: "", category: "exhibitor", booth_number: "", zone_id: "", description: "" });

  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [sessionForm, setSessionForm] = useState({ title: "", speaker_name: "", location: "", zone_id: "", start_time: "", end_time: "", description: "" });

  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [activityForm, setActivityForm] = useState({ title: "", description: "", points: 50, zone_id: "", activity_type: "scavenger_hunt" });

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

  const fetchContent = useCallback(() => {
    if (!selectedEventId) return;
    setLoading(true);

    const endpoints = [
      api.get(`/api/organizer/zones/${selectedEventId}`).catch(() => ({ zones: [] })),
    ];

    if (activeTab === "booths") {
      endpoints.push(api.get(`/api/organizer/booths/${selectedEventId}`).catch(() => ({ booths: [] })));
    } else if (activeTab === "sessions") {
      endpoints.push(api.get(`/api/organizer/sessions/${selectedEventId}`).catch(() => ({ sessions: [] })));
    } else {
      endpoints.push(api.get(`/api/organizer/activities/${selectedEventId}`).catch(() => ({ activities: [] })));
    }

    Promise.all(endpoints)
      .then(([zoneData, tabData]) => {
        setZones(zoneData.zones || []);
        if (activeTab === "booths") setBooths(tabData.booths || []);
        else if (activeTab === "sessions") setSessions(tabData.sessions || []);
        else setActivities(tabData.activities || []);
      })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [selectedEventId, activeTab, toast]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // Booth Handlers
  const handleSaveBooth = async (e) => {
    e.preventDefault();
    try {
      if (editingBooth) {
        await api.put(`/api/organizer/booths/${editingBooth.id}`, boothForm);
        toast("Booth updated", "success");
      } else {
        await api.post("/api/organizer/booths", { ...boothForm, event_id: selectedEventId });
        toast("Booth created", "success");
      }
      setIsBoothModalOpen(false);
      fetchContent();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const handleDeleteBooth = async (id) => {
    if (!window.confirm("Delete this booth?")) return;
    try {
      await api.delete(`/api/organizer/booths/${id}`);
      toast("Booth deleted", "success");
      fetchContent();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Session Handlers
  const handleSaveSession = async (e) => {
    e.preventDefault();
    try {
      if (editingSession) {
        await api.put(`/api/organizer/sessions/${editingSession.id}`, sessionForm);
        toast("Session updated", "success");
      } else {
        await api.post("/api/organizer/sessions", { ...sessionForm, event_id: selectedEventId });
        toast("Session scheduled", "success");
      }
      setIsSessionModalOpen(false);
      fetchContent();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const handleDeleteSession = async (id) => {
    if (!window.confirm("Delete this session?")) return;
    try {
      await api.delete(`/api/organizer/sessions/${id}`);
      toast("Session deleted", "success");
      fetchContent();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Activity Handlers
  const handleSaveActivity = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...activityForm,
        points: parseInt(activityForm.points, 10) || 50,
      };
      if (editingActivity) {
        await api.put(`/api/organizer/activities/${editingActivity.id}`, payload);
        toast("Quest updated", "success");
      } else {
        await api.post("/api/organizer/activities", { ...payload, event_id: selectedEventId });
        toast("Quest created", "success");
      }
      setIsActivityModalOpen(false);
      fetchContent();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const handleDeleteActivity = async (id) => {
    if (!window.confirm("Delete this quest/activity?")) return;
    try {
      await api.delete(`/api/organizer/activities/${id}`);
      toast("Quest deleted", "success");
      fetchContent();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Content, Agenda & Quests</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Map exhibitors, stage sessions, and gamified attendee quests to venue zones.
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
          <button 
            className="btn btn-primary"
            onClick={() => {
              if (activeTab === "booths") {
                setEditingBooth(null);
                setBoothForm({ name: "", category: "exhibitor", booth_number: "", zone_id: "", description: "" });
                setIsBoothModalOpen(true);
              } else if (activeTab === "sessions") {
                setEditingSession(null);
                setSessionForm({ title: "", speaker_name: "", location: "", zone_id: "", start_time: "", end_time: "", description: "" });
                setIsSessionModalOpen(true);
              } else {
                setEditingActivity(null);
                setActivityForm({ title: "", description: "", points: 50, zone_id: "", activity_type: "scavenger_hunt" });
                setIsActivityModalOpen(true);
              }
            }}
          >
            <LuPlus size={16} /> Add {activeTab === "booths" ? "Booth" : activeTab === "sessions" ? "Session" : "Quest"}
          </button>
        </div>
      </div>

      <div className="card">
        {/* TAB TOGGLES */}
        <div style={{ display: "flex", gap: "12px", padding: "16px", borderBottom: "1px solid var(--border-light)" }}>
          <button 
            className={`btn btn-sm ${activeTab === "booths" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("booths")}
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            <LuStore size={15} /> Exhibitor Booths ({booths.length})
          </button>
          <button 
            className={`btn btn-sm ${activeTab === "sessions" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("sessions")}
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            <LuCalendarPlus size={15} /> Stage Sessions ({sessions.length})
          </button>
          <button 
            className={`btn btn-sm ${activeTab === "activities" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("activities")}
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            <LuTrophy size={15} /> Gamified Quests ({activities.length})
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center" }}><div className="spinner"></div></div>
        ) : activeTab === "booths" ? (
          /* BOOTHS TABLE */
          booths.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuStore /></div>
              <div className="empty-state-title">No booths configured</div>
              <div className="empty-state-text">Add exhibitor booths and link them to spatial venue zones.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booth Name</th>
                    <th>Category</th>
                    <th>Booth #</th>
                    <th>Assigned Zone</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {booths.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td><span className="badge">{b.category}</span></td>
                      <td>{b.booth_number || "—"}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--primary)" }}>
                          <LuMapPin size={13} /> {zones.find(z => z.id === b.zone_id)?.name || b.zone_name || "Unmapped"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingBooth(b); setBoothForm(b); setIsBoothModalOpen(true); }}><LuPencil size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteBooth(b.id)} style={{ color: "var(--error)" }}><LuTrash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : activeTab === "sessions" ? (
          /* SESSIONS TABLE */
          sessions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuCalendarPlus /></div>
              <div className="empty-state-title">No sessions scheduled</div>
              <div className="empty-state-text">Schedule speaker presentations and bind them to venue zones.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title & Speaker</th>
                    <th>Time</th>
                    <th>Mapped Zone</th>
                    <th>Location / Stage</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.title}</strong>
                        {s.speaker_name && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>By: {s.speaker_name}</div>}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem" }}>
                          <LuClock size={12} /> {s.start_time || "TBD"} – {s.end_time || ""}
                        </div>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--primary)" }}>
                          <LuMapPin size={13} /> {zones.find(z => z.id === s.zone_id)?.name || s.zone_name || "Main Stage"}
                        </span>
                      </td>
                      <td>{s.location || "Stage 1"}</td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingSession(s); setSessionForm(s); setIsSessionModalOpen(true); }}><LuPencil size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteSession(s.id)} style={{ color: "var(--error)" }}><LuTrash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* ACTIVITIES / QUESTS TABLE */
          activities.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuTrophy /></div>
              <div className="empty-state-title">No gamified quests defined</div>
              <div className="empty-state-text">Create zone exploration quests and rewards for attendees.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Quest Title</th>
                    <th>Points Reward</th>
                    <th>Zone</th>
                    <th>Type</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map(a => (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.title}</strong>
                        {a.description && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{a.description}</div>}
                      </td>
                      <td>
                        <span style={{ color: "var(--warning)", fontWeight: "700" }}>+{a.points || 50} pts</span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--primary)" }}>
                          <LuMapPin size={13} /> {zones.find(z => z.id === a.zone_id)?.name || a.zone_name || "Exploration"}
                        </span>
                      </td>
                      <td><span className="badge info">{a.activity_type || "Quest"}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingActivity(a); setActivityForm(a); setIsActivityModalOpen(true); }}><LuPencil size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteActivity(a.id)} style={{ color: "var(--error)" }}><LuTrash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* BOOTH MODAL */}
      {isBoothModalOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsBoothModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "460px" }}>
            <div className="modal-header">
              <h3>{editingBooth ? "Edit Booth" : "Add Exhibitor Booth"}</h3>
              <button className="btn btn-ghost" onClick={() => setIsBoothModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSaveBooth} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="form-group">
                  <label className="form-label">Booth Name *</label>
                  <input type="text" className="form-input" value={boothForm.name} onChange={e => setBoothForm({...boothForm, name: e.target.value})} required />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Booth Number</label>
                    <input type="text" className="form-input" value={boothForm.booth_number} onChange={e => setBoothForm({...boothForm, booth_number: e.target.value})} placeholder="e.g. B-12" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sector / Zone</label>
                    <select className="form-select" value={boothForm.zone_id} onChange={e => setBoothForm({...boothForm, zone_id: e.target.value})}>
                      <option value="">-- Select Zone --</option>
                      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea className="form-textarea" value={boothForm.description} onChange={e => setBoothForm({...boothForm, description: e.target.value})} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsBoothModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Booth</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* SESSION MODAL */}
      {isSessionModalOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsSessionModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3>{editingSession ? "Edit Session" : "Schedule Presentation Session"}</h3>
              <button className="btn btn-ghost" onClick={() => setIsSessionModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSaveSession} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="form-group">
                  <label className="form-label">Session Title *</label>
                  <input type="text" className="form-input" value={sessionForm.title} onChange={e => setSessionForm({...sessionForm, title: e.target.value})} required />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Speaker Name</label>
                    <input type="text" className="form-input" value={sessionForm.speaker_name} onChange={e => setSessionForm({...sessionForm, speaker_name: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mapped Zone</label>
                    <select className="form-select" value={sessionForm.zone_id} onChange={e => setSessionForm({...sessionForm, zone_id: e.target.value})}>
                      <option value="">-- Select Zone --</option>
                      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Start Time</label>
                    <input type="time" className="form-input" value={sessionForm.start_time} onChange={e => setSessionForm({...sessionForm, start_time: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Time</label>
                    <input type="time" className="form-input" value={sessionForm.end_time} onChange={e => setSessionForm({...sessionForm, end_time: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsSessionModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Session</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVITY MODAL */}
      {isActivityModalOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsActivityModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "460px" }}>
            <div className="modal-header">
              <h3>{editingActivity ? "Edit Quest" : "Create Gamified Quest"}</h3>
              <button className="btn btn-ghost" onClick={() => setIsActivityModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSaveActivity} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="form-group">
                  <label className="form-label">Quest Title *</label>
                  <input type="text" className="form-input" value={activityForm.title} onChange={e => setActivityForm({...activityForm, title: e.target.value})} required />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Points Reward</label>
                    <input type="number" className="form-input" value={activityForm.points} onChange={e => setActivityForm({...activityForm, points: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Target Zone</label>
                    <select className="form-select" value={activityForm.zone_id} onChange={e => setActivityForm({...activityForm, zone_id: e.target.value})}>
                      <option value="">-- Any Zone --</option>
                      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description & Clue</label>
                  <textarea className="form-textarea" placeholder="Describe the quest clue or task..." value={activityForm.description} onChange={e => setActivityForm({...activityForm, description: e.target.value})} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsActivityModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Quest</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
