import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { formatDate, formatTime, getStatusColor } from "../utils/validators";
import { 
  LuPlus, 
  LuMapPin, 
  LuClock, 
  LuUsers, 
  LuTrash2, 
  LuCalendarDays,
  LuShieldAlert,
  LuPlay,
  LuPause,
  LuSquare,
  LuSend,
  LuCheck
} from "react-icons/lu";
import EventCountdown from "../components/EventCountdown";

const STATUS_TRANSITIONS = {
  draft: ["published", "upcoming"],
  upcoming: ["live", "draft"],
  published: ["live", "upcoming"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: ["upcoming"],
};

export default function OrganizerEvents() {
  const toast = useToast();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [publishingEapId, setPublishingEapId] = useState(null);

  useEffect(() => {
    api.get("/api/events/organizer/mine")
      .then((data) => setEvents(data.events || []))
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  const handleStatusChange = async (eventId, newStatus, e) => {
    if (e) e.stopPropagation();
    try {
      await api.put(`/api/events/${eventId}/status`, { status: newStatus });
      setEvents((prev) => prev.map((ev) => ev.id === eventId ? { ...ev, status: newStatus } : ev));
      toast(`Event status transitioned to "${newStatus}"`, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const handlePublishEap = async (eventId, eventName, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`Publish Emergency Action Plan (EAP) for "${eventName}" to all active staff and volunteers?`)) return;

    setPublishingEapId(eventId);
    try {
      await api.post(`/api/organizer/eap/${eventId}/publish`);
      toast(`Emergency Action Plan published for ${eventName}!`, "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setPublishingEapId(null);
    }
  };

  const handleDelete = async (eventId, eventName, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete "${eventName}"? This action cannot be undone.`)) return;
    try {
      await api.delete(`/api/events/${eventId}`);
      setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
      toast("Event deleted", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const filtered = filter === "all" ? events : events.filter((e) => e.status === filter);

  if (loading) {
    return <div className="loading-screen" style={{ minHeight: "60vh" }}><div className="spinner"></div></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Events Portfolio</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Lifecycle controls, status transitions, and emergency preparedness.
          </p>
        </div>
        <Link to="/organizer/create-event" className="btn btn-primary">
          <LuPlus size={16} /> New Event
        </Link>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        {["all", "draft", "upcoming", "published", "live", "paused", "ended"].map((f) => {
          const count = f === "all" ? events.length : events.filter((e) => e.status === f).length;
          return (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length > 0 ? (
        <div className="events-grid">
          {filtered.map((event) => {
            const nextStatuses = STATUS_TRANSITIONS[event.status] || ["live", "ended"];
            const isPublishingEap = publishingEapId === event.id;

            return (
              <div 
                key={event.id} 
                className="event-card" 
                onClick={() => navigate(`/organizer/events/${event.id}`)}
                style={{ cursor: "pointer", display: "flex", flexDirection: "column" }}
              >
                <div className="event-card-header">
                  <div className="event-card-title">{event.name}</div>
                  <span className={`badge ${getStatusColor(event.status)}`}>{event.status}</span>
                </div>

                {event.description && (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                    {event.description.slice(0, 100)}{event.description.length > 100 ? "..." : ""}
                  </p>
                )}

                <div className="event-card-meta">
                  <div className="event-card-meta-item">
                    <LuMapPin className="meta-icon" size={14} />{event.venue || "Unassigned Venue"}
                  </div>
                  <div className="event-card-meta-item">
                    <LuClock className="meta-icon" size={14} />
                    {formatDate(event.event_date)}
                    {event.start_time ? ` · ${formatTime(event.start_time)}` : ""}
                    {event.end_time ? ` – ${formatTime(event.end_time)}` : ""}
                  </div>
                  {event.capacity > 0 && (
                    <div className="event-card-meta-item">
                      <LuUsers className="meta-icon" size={14} />Capacity: {event.capacity}
                    </div>
                  )}
                </div>

                {event.zones?.length > 0 && (
                  <div className="event-card-zones" style={{ marginTop: "12px" }}>
                    {event.zones.map((z) => <span key={z} className="zone-tag">{z}</span>)}
                  </div>
                )}

                {/* Status Transitions Bar & EAP Publish */}
                <div 
                  style={{ 
                    marginTop: "auto", 
                    paddingTop: "14px", 
                    borderTop: "1px solid var(--border-light)", 
                    display: "flex", 
                    flexDirection: "column", 
                    gap: "10px" 
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Status Change Action Buttons */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>Transition:</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {nextStatuses.map(ns => (
                        <button
                          key={ns}
                          className="btn btn-sm btn-ghost"
                          style={{ padding: "2px 8px", fontSize: "0.75rem", textTransform: "capitalize" }}
                          onClick={(e) => handleStatusChange(event.id, ns, e)}
                        >
                          {ns === "live" && <LuPlay size={12} color="var(--success)" />}
                          {ns === "paused" && <LuPause size={12} color="var(--warning)" />}
                          {ns === "ended" && <LuSquare size={12} color="var(--error)" />}
                          {ns === "published" && <LuSend size={12} color="var(--primary)" />}
                          Set {ns}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Footer actions: EAP Publish & Delete */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <button
                      className="btn btn-sm btn-outline"
                      style={{ 
                        fontSize: "0.75rem", 
                        padding: "4px 8px", 
                        borderColor: "rgba(239, 68, 68, 0.4)", 
                        color: "var(--error)" 
                      }}
                      onClick={(e) => handlePublishEap(event.id, event.name, e)}
                      disabled={isPublishingEap}
                      title="Publish Emergency Action Plan to staff"
                    >
                      <LuShieldAlert size={13} />
                      {isPublishingEap ? "Publishing..." : "Publish EAP"}
                    </button>

                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {event.status === "upcoming" && (
                        <EventCountdown 
                          eventDate={event.event_date} 
                          startTime={event.start_time} 
                          onComplete={() => handleStatusChange(event.id, "live")} 
                        />
                      )}
                      <button 
                        className="btn btn-sm btn-ghost" 
                        onClick={(e) => handleDelete(event.id, event.name, e)} 
                        style={{ color: "var(--error)", padding: "4px 6px" }}
                        title="Delete Event"
                      >
                        <LuTrash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon"><LuCalendarDays /></div>
          <div className="empty-state-title">{filter === "all" ? "No events yet" : `No ${filter} events`}</div>
          <div className="empty-state-text">
            {filter === "all" ? "Create your first event to get started." : "Change the filter to see other events."}
          </div>
        </div>
      )}
    </div>
  );
}
