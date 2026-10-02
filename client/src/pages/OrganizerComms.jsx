import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { 
  LuMail, 
  LuSend, 
  LuUsers, 
  LuMapPin, 
  LuMegaphone, 
  LuCheckCheck,
  LuSparkles,
  LuEye,
  LuTriangleAlert
} from "react-icons/lu";

const CANNED_BROADCASTS = [
  {
    title: "Urgent Weather Advisory",
    priority: "urgent",
    target_type: "broadcast",
    requires_ack: true,
    content: "ATTENTION ALL STAFF: High-velocity wind and storm alert issued. Please secure all outdoor temporary structures, canopies, and lightweight signage immediately."
  },
  {
    title: "Medical Standby Alert",
    priority: "important",
    target_type: "broadcast",
    requires_ack: true,
    content: "All medical personnel and sector marshals: Emergency medical transport arriving at Gate 4. Maintain a clear 10-meter access corridor."
  },
  {
    title: "Egress Concourse Halt",
    priority: "urgent",
    target_type: "broadcast",
    requires_ack: true,
    content: "CRITICAL: Temporary turnstile entry pause active at North Concourse. Please guide incoming foot traffic towards the East Annex Plaza."
  },
  {
    title: "All Clear Resumption",
    priority: "routine",
    target_type: "broadcast",
    requires_ack: false,
    content: "Operational notice: Incident clear. Normal scheduled event operations, turnstiles, and stage schedules have fully resumed."
  }
];

export default function OrganizerComms() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Compose form state
  const [composeText, setComposeText] = useState("");
  const [targetType, setTargetType] = useState("broadcast");
  const [priority, setPriority] = useState("routine");
  const [requiresAck, setRequiresAck] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Receipts modal
  const [receiptMsg, setReceiptMsg] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);

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

  const fetchMessages = useCallback(() => {
    if (!selectedEventId) return;
    setLoading(true);
    api.get(`/api/organizer/comms/${selectedEventId}`)
      .then((data) => setMessages(data.messages || []))
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!composeText.trim()) return;
    
    setIsSending(true);
    try {
      await api.post("/api/organizer/comms", {
        event_id: selectedEventId,
        content: composeText,
        target_type: targetType,
        priority: priority,
        requires_ack: requiresAck
      });
      toast("Message broadcast successfully", "success");
      setComposeText("");
      fetchMessages();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setIsSending(false);
    }
  };

  const applyTemplate = (tmpl) => {
    setComposeText(tmpl.content);
    setPriority(tmpl.priority);
    setTargetType(tmpl.target_type);
    setRequiresAck(tmpl.requires_ack);
  };

  const handleViewReceipts = async (msg) => {
    setReceiptMsg(msg);
    setLoadingReceipts(true);
    try {
      const res = await api.get(`/api/organizer/comms/${msg.id}/receipts`);
      setReceipts(res.receipts || []);
    } catch {
      setReceipts([]);
    } finally {
      setLoadingReceipts(false);
    }
  };

  const getTargetIcon = (type) => {
    switch(type) {
      case "broadcast": return <LuMegaphone />;
      case "team": return <LuUsers />;
      case "zone": return <LuMapPin />;
      default: return <LuMail />;
    }
  };

  const getPriorityColor = (prio) => {
    switch(prio) {
      case "urgent": return "var(--error)";
      case "important": return "var(--warning)";
      default: return "var(--info)";
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Communications Console & Dispatch Radio</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Canned emergency protocols, high-priority broadcasts, and real-time read receipt tracking.
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
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.9fr", gap: "24px" }}>
        
        {/* COMPOSE PANEL */}
        <div className="card" style={{ alignSelf: "start" }}>
          <div className="card-header">
            <h3 className="card-title">Broadcast Dispatch</h3>
          </div>
          <div style={{ padding: "16px" }}>
            
            {/* Canned Templates */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: "700", color: "var(--text-secondary)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <LuSparkles size={14} color="var(--primary)" /> Emergency Protocol Templates:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {CANNED_BROADCASTS.map((tmpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ textAlign: "left", justifyContent: "flex-start", fontSize: "0.75rem", background: "var(--bg-secondary)" }}
                    onClick={() => applyTemplate(tmpl)}
                  >
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: getPriorityColor(tmpl.priority), marginRight: "6px" }} />
                    {tmpl.title}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSendMessage} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">Audience Target</label>
                <select 
                  className="form-select" 
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value)}
                >
                  <option value="broadcast">Event-wide Broadcast (All Staff)</option>
                  <option value="team">Sector Squads</option>
                  <option value="zone">Specific Zone Staff</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Priority</label>
                <div style={{ display: "flex", gap: "16px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input type="radio" name="priority" value="routine" checked={priority === "routine"} onChange={() => setPriority("routine")} /> Routine
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", cursor: "pointer", color: "var(--warning)" }}>
                    <input type="radio" name="priority" value="important" checked={priority === "important"} onChange={() => setPriority("important")} /> Important
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", cursor: "pointer", color: "var(--error)" }}>
                    <input type="radio" name="priority" value="urgent" checked={priority === "urgent"} onChange={() => setPriority("urgent")} /> Urgent
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Message Content</label>
                <textarea 
                  className="form-textarea"
                  style={{ minHeight: "110px" }}
                  placeholder="Enter message text..."
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", cursor: "pointer" }}>
                  <input 
                    type="checkbox" 
                    checked={requiresAck}
                    onChange={(e) => setRequiresAck(e.target.checked)}
                  />
                  Require explicit volunteer acknowledgment (Read Receipts)
                </label>
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: "100%", justifyContent: "center", marginTop: "8px" }}
                disabled={isSending || !composeText.trim()}
              >
                {isSending ? <div className="spinner" style={{ width: "16px", height: "16px" }}></div> : <LuSend size={16} />}
                Send Broadcast
              </button>
            </form>
          </div>
        </div>

        {/* MESSAGE HISTORY */}
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">Broadcast History & ACK Receipts</h3>
            <span className="badge">{messages.length} total messages</span>
          </div>
          
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center" }}><div className="spinner"></div></div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><LuMail /></div>
              <div className="empty-state-title">No broadcasts sent</div>
              <div className="empty-state-text">
                Operational transmissions and alerts will be logged here.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ padding: "16px", borderBottom: "1px solid var(--border-light)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ 
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "32px", height: "32px", borderRadius: "8px",
                        backgroundColor: "var(--bg-secondary)", color: getPriorityColor(msg.priority)
                      }}>
                        {getTargetIcon(msg.target_type)}
                      </div>
                      <div>
                        <div style={{ fontWeight: "700", fontSize: "0.9rem" }}>
                          To: {msg.target_type.toUpperCase()} {msg.target_id ? `(${msg.target_id})` : ""}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {new Date(msg.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {msg.requires_acknowledgment && (
                        <button 
                          className="btn btn-sm btn-ghost" 
                          onClick={() => handleViewReceipts(msg)}
                          style={{ fontSize: "0.75rem", color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: "4px" }}
                          title="View Read Receipts"
                        >
                          <LuEye size={13} /> View Receipts
                        </button>
                      )}
                      <span style={{ 
                        fontSize: "0.7rem", 
                        fontWeight: "700", 
                        padding: "2px 6px", 
                        borderRadius: "4px", 
                        backgroundColor: `${getPriorityColor(msg.priority)}20`, 
                        color: getPriorityColor(msg.priority) 
                      }}>
                        {msg.priority?.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div style={{ backgroundColor: "var(--bg-secondary)", padding: "12px", borderRadius: "8px", fontSize: "0.85rem", lineHeight: "1.5" }}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ACK RECEIPTS MODAL */}
      {receiptMsg && (
        <div className="modal-backdrop fade-in" onClick={() => setReceiptMsg(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <LuCheckCheck color="var(--success)" /> Read Receipts & ACKs
              </h3>
              <button className="btn btn-ghost" onClick={() => setReceiptMsg(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ background: "var(--bg-secondary)", padding: "10px", borderRadius: "6px", marginBottom: "12px", fontSize: "0.85rem" }}>
                "{receiptMsg.content.slice(0, 100)}{receiptMsg.content.length > 100 ? "..." : ""}"
              </div>

              {loadingReceipts ? (
                <div style={{ padding: "20px", textAlign: "center" }}><div className="spinner"></div></div>
              ) : receipts.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "16px" }}>
                  No staff members have acknowledged this message yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                  {receipts.map((rcpt, idx) => (
                    <div key={rcpt.id || idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: "6px", fontSize: "0.85rem" }}>
                      <strong>{rcpt.volunteer_name || rcpt.recipient_id?.slice(0, 8)}</strong>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        ACK: {new Date(rcpt.acknowledged_at || rcpt.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
