import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/api";
import { useToast } from "./Toast";
import { 
  LuShieldAlert, 
  LuClock, 
  LuLightbulb, 
  LuSquareCheck, 
  LuRadio, 
  LuCheck, 
  LuLoader 
} from "react-icons/lu";

const RISK_STYLE = {
  critical: { color: "var(--error)", label: "Critical" },
  warning: { color: "var(--warning)", label: "Warning" },
  watch: { color: "var(--info)", label: "Watch" },
};

const HORIZON_OPTIONS = [10, 15, 30];

export default function CrowdPredictionPanel({ eventId, horizon: defaultHorizon = 15 }) {
  const toast = useToast();
  const [selectedHorizon, setSelectedHorizon] = useState(defaultHorizon);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Action dispatch states
  const [actionLoading, setActionLoading] = useState({});
  const [dispatchedTasks, setDispatchedTasks] = useState({});
  const [dispatchedComms, setDispatchedComms] = useState({});

  const load = useCallback((showSpinner = false) => {
    if (!eventId) return;
    if (showSpinner) setLoading(true);
    api.get(`/api/organizer/crowd/${eventId}/predictions?horizon=${selectedHorizon}`)
      .then((d) => { 
        setData(d); 
        setError(""); 
      })
      .catch((e) => setError(e.message || "Prediction unavailable"))
      .finally(() => {
        if (showSpinner) setLoading(false);
      });
  }, [eventId, selectedHorizon]);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 10000);
    return () => clearInterval(t);
  }, [load]);

  // Handler: Dispatch Volunteer Task from suggested action
  const handleDispatchTask = async (prediction) => {
    const zid = prediction.zone_id;
    setActionLoading((prev) => ({ ...prev, [`task_${zid}`]: true }));
    try {
      await api.post("/api/organizer/tasks", {
        event_id: eventId,
        title: `Crowd Mitigation: ${prediction.zone_name}`,
        description: prediction.suggested_action,
        zone_name: prediction.zone_name,
        zone_id: zid,
        priority: prediction.risk === "critical" ? "urgent" : "high",
      });
      toast(`Volunteer task dispatched for ${prediction.zone_name}!`, "success");
      setDispatchedTasks((prev) => ({ ...prev, [zid]: true }));
    } catch (err) {
      toast(err.message || "Failed to dispatch task", "error");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`task_${zid}`]: false }));
    }
  };

  // Handler: Broadcast Radio Announcement from suggested action
  const handleBroadcastAlert = async (prediction) => {
    const zid = prediction.zone_id;
    setActionLoading((prev) => ({ ...prev, [`comm_${zid}`]: true }));
    try {
      await api.post("/api/organizer/comms", {
        event_id: eventId,
        content: `[Crowd Alert — ${prediction.zone_name}] Predicted ${Math.round((prediction.projected_ratio || 0) * 100)}% capacity. ${prediction.suggested_action}`,
        target_type: "broadcast",
        priority: prediction.risk === "critical" ? "urgent" : "routine",
        requires_ack: prediction.risk === "critical",
      });
      toast(`Staff alert broadcasted for ${prediction.zone_name}!`, "success");
      setDispatchedComms((prev) => ({ ...prev, [zid]: true }));
    } catch (err) {
      toast(err.message || "Failed to broadcast announcement", "error");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`comm_${zid}`]: false }));
    }
  };

  const atRisk = (data?.predictions || []).filter((p) => RISK_STYLE[p.risk]);

  return (
    <div className="card" id="crowd-prediction-panel" style={{ marginBottom: "24px", padding: "20px" }}>
      {/* Header with Title and Horizon Selection */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
          <LuShieldAlert size={18} color="var(--primary)" /> Predicted Overcrowding
        </h3>
        
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Horizon:</span>
          <div style={{ display: "flex", gap: "4px", background: "rgba(255,255,255,0.05)", padding: "3px", borderRadius: "6px" }}>
            {HORIZON_OPTIONS.map((h) => {
              const isSelected = selectedHorizon === h;
              return (
                <button
                  key={h}
                  type="button"
                  id={`horizon-btn-${h}`}
                  onClick={() => setSelectedHorizon(h)}
                  style={{
                    cursor: "pointer",
                    padding: "3px 9px",
                    borderRadius: "4px",
                    border: "none",
                    background: isSelected ? "var(--primary)" : "transparent",
                    color: isSelected ? "#fff" : "var(--text-muted)",
                    fontWeight: isSelected ? 700 : 500,
                    fontSize: "0.75rem",
                    transition: "all 0.15s ease",
                  }}
                >
                  {h}m
                </button>
              );
            })}
          </div>
          <span className="badge info" style={{ fontSize: "0.75rem" }}>
            Next {data?.horizon_minutes || selectedHorizon} min
          </span>
        </div>
      </div>

      {loading && (
        <div style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Calculating predictive flow trajectory...
        </div>
      )}

      {error && <div style={{ color: "var(--error)", fontSize: "0.85rem" }}>{error}</div>}

      {!loading && !error && data && atRisk.length === 0 && (
        <div style={{ color: "var(--success)", fontSize: "0.9rem", padding: "8px 0" }}>
          ✓ No zone is projected to exceed capacity thresholds in the next {data.horizon_minutes} minutes.
        </div>
      )}

      {/* At-Risk Zone Cards */}
      <div style={{ display: "grid", gap: "14px" }}>
        {atRisk.map((p) => {
          const s = RISK_STYLE[p.risk];
          const zid = p.zone_id;
          const isTaskBusy = actionLoading[`task_${zid}`];
          const isCommBusy = actionLoading[`comm_${zid}`];
          const hasTaskDispatched = dispatchedTasks[zid];
          const hasCommDispatched = dispatchedComms[zid];

          return (
            <div 
              key={zid} 
              id={`prediction-card-${zid}`}
              style={{ 
                borderLeft: `4px solid ${s.color}`, 
                background: "rgba(255,255,255,0.03)", 
                borderRadius: "8px", 
                padding: "14px 16px" 
              }}
            >
              {/* Header row: Zone name, risk, projected % */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "baseline" }}>
                <strong style={{ fontSize: "0.95rem" }}>{p.zone_name}</strong>
                <span style={{ color: s.color, fontWeight: 700, fontSize: "0.85rem" }}>
                  {s.label} · {Math.round((p.projected_ratio || 0) * 100)}% projected
                  {p.current_ratio != null && (
                    <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: "0.8rem", marginLeft: "6px" }}>
                      (now {Math.round(p.current_ratio * 100)}%)
                    </span>
                  )}
                </span>
              </div>

              {/* ETA and Confidence */}
              <div style={{ display: "flex", gap: "16px", marginTop: "6px", fontSize: "0.8rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <LuClock size={14} color="var(--primary)" />
                  {p.eta_minutes === 0 ? "Threshold already reached" : p.eta_minutes != null ? `~${p.eta_minutes} min to warning` : "Stable rate"}
                </span>
                <span>Confidence: {Math.round((p.confidence || 0) * 100)}%</span>
              </div>

              {/* Drivers list */}
              {p.drivers?.length > 0 && (
                <ul style={{ margin: "8px 0 0 18px", fontSize: "0.8rem", color: "var(--text-muted)", paddingLeft: 0 }}>
                  {p.drivers.map((d, i) => (
                    <li key={i} style={{ marginBottom: "2px" }}>{d}</li>
                  ))}
                </ul>
              )}

              {/* Suggested Action & One-Click Mitigation Dispatches */}
              {p.suggested_action && (
                <div style={{ marginTop: "12px", padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: "0.83rem", display: "flex", gap: "6px", alignItems: "flex-start", marginBottom: "10px" }}>
                    <LuLightbulb size={15} color="var(--warning)" style={{ marginTop: "2px", flexShrink: 0 }} /> 
                    <span>{p.suggested_action}</span>
                  </div>

                  {/* Action Shortcuts */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      id={`btn-dispatch-task-${zid}`}
                      onClick={() => handleDispatchTask(p)}
                      disabled={isTaskBusy || hasTaskDispatched}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.75rem",
                        padding: "5px 10px",
                        borderRadius: "5px",
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: hasTaskDispatched ? "rgba(34, 197, 94, 0.2)" : "rgba(255,255,255,0.05)",
                        color: hasTaskDispatched ? "var(--success)" : "var(--text-main)",
                        cursor: hasTaskDispatched ? "default" : "pointer",
                        fontWeight: 600,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {isTaskBusy ? <LuLoader className="spin" size={13} /> : hasTaskDispatched ? <LuCheck size={13} /> : <LuSquareCheck size={13} />}
                      {hasTaskDispatched ? "Task Dispatched" : "Dispatch Task"}
                    </button>

                    <button
                      type="button"
                      id={`btn-broadcast-alert-${zid}`}
                      onClick={() => handleBroadcastAlert(p)}
                      disabled={isCommBusy || hasCommDispatched}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.75rem",
                        padding: "5px 10px",
                        borderRadius: "5px",
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: hasCommDispatched ? "rgba(34, 197, 94, 0.2)" : "rgba(255,255,255,0.05)",
                        color: hasCommDispatched ? "var(--success)" : "var(--text-main)",
                        cursor: hasCommDispatched ? "default" : "pointer",
                        fontWeight: 600,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {isCommBusy ? <LuLoader className="spin" size={13} /> : hasCommDispatched ? <LuCheck size={13} /> : <LuRadio size={13} />}
                      {hasCommDispatched ? "Alert Sent" : "Broadcast Alert"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
