import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../utils/api";
import { 
  LuSquareCheck, 
  LuPlus, 
  LuMapPin, 
  LuUser, 
  LuClock, 
  LuPlay, 
  LuCheck, 
  LuSparkles,
  LuCalendar
} from "react-icons/lu";

const TASK_TEMPLATES = [
  { title: "Barricade & Perimeter Safety Sweep", priority: "urgent", description: "Verify safety barriers, emergency egress pathways, and turnstile locks are clear." },
  { title: "Water & Relief Station Refill", priority: "routine", description: "Replenish hydration stations and check cup/dispenser supplies across concourse." },
  { title: "Medical First-Aid Kit Audit", priority: "high", description: "Inspect AED devices, oxygen tanks, and trauma supplies at active aid post." },
  { title: "Restroom Hygiene & Sanitation Check", priority: "routine", description: "Ensure sanitation facilities are cleaned, stocked, and accessible." },
];

export default function OrganizerTasks() {
  const { user: _user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [tasks, setTasks] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    zone_name: "",
    assigned_to: "",
    priority: "routine",
    due_at: "",
  });

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

  const fetchTasksAndStaff = useCallback(() => {
    if (!selectedEventId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/organizer/tasks/${selectedEventId}`),
      api.get(`/api/organizer/volunteers/${selectedEventId}`).catch(() => ({ assignments: [] })),
      api.get(`/api/organizer/zones/${selectedEventId}`).catch(() => ({ zones: [] })),
    ])
      .then(([tData, vData, zData]) => {
        setTasks(tData.tasks || []);
        setVolunteers(vData.assignments || []);
        setZones(zData.zones || []);
      })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchTasksAndStaff();
  }, [fetchTasksAndStaff]);

  // Create Task
  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      await api.post("/api/organizer/tasks", {
        ...newTask,
        event_id: selectedEventId,
      });
      toast("Task created and dispatched", "success");
      setIsModalOpen(false);
      setNewTask({
        title: "",
        description: "",
        zone_name: "",
        assigned_to: "",
        priority: "routine",
        due_at: "",
      });
      fetchTasksAndStaff();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // Pre-fill Template
  const applyTemplate = (tmpl) => {
    setNewTask(prev => ({
      ...prev,
      title: tmpl.title,
      priority: tmpl.priority,
      description: tmpl.description,
    }));
  };

  // Status Transitions
  const handleUpdateStatus = async (taskId, newStatus) => {
    try {
      await api.put(`/api/organizer/tasks/${taskId}`, { status: newStatus });
      toast(`Task moved to ${newStatus}`, "success");
      fetchTasksAndStaff();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case "urgent": return "var(--error)";
      case "high": return "var(--warning)";
      default: return "var(--info)";
    }
  };

  const pendingTasks = tasks.filter(t => t.status === "pending" || t.status === "assigned");
  const inProgressTasks = tasks.filter(t => t.status === "in_progress" || t.status === "acknowledged");
  const completedTasks = tasks.filter(t => t.status === "completed" || t.status === "cancelled");

  const TaskCard = ({ task }) => {
    const isPending = task.status === "pending" || task.status === "assigned";
    const isInProgress = task.status === "in_progress" || task.status === "acknowledged";
    const isCompleted = task.status === "completed";

    return (
      <div className="card" style={{ marginBottom: "12px", padding: "14px", backgroundColor: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: getPriorityColor(task.priority) }} />
            <div style={{ fontWeight: "700", fontSize: "0.95rem" }}>{task.title}</div>
          </div>
          <span style={{ fontSize: "0.7rem", fontWeight: "700", textTransform: "uppercase", color: getPriorityColor(task.priority) }}>
            {task.priority}
          </span>
        </div>
        
        {task.description && (
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "10px", lineHeight: "1.4" }}>
            {task.description}
          </div>
        )}
        
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "10px" }}>
          {task.zone_name && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <LuMapPin size={12} color="var(--primary)" /> <strong>{task.zone_name}</strong>
            </div>
          )}
          {task.assigned_to ? (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <LuUser size={12} /> {task.assigned_to_name || task.assigned_to.substring(0, 8)}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--warning)" }}>
              <LuUser size={12} /> Unassigned
            </div>
          )}
          {task.due_at && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--info)" }}>
              <LuClock size={12} /> Due: {new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* Quick Transition Action */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", borderTop: "1px solid var(--border-light)", paddingTop: "8px" }}>
          {isPending && (
            <button
              className="btn btn-sm btn-ghost"
              style={{ fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
              onClick={() => handleUpdateStatus(task.id, "in_progress")}
            >
              <LuPlay size={12} color="var(--info)" /> Start Task
            </button>
          )}
          {isInProgress && (
            <button
              className="btn btn-sm btn-primary"
              style={{ fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
              onClick={() => handleUpdateStatus(task.id, "completed")}
            >
              <LuCheck size={12} /> Mark Done
            </button>
          )}
          {isCompleted && (
            <span style={{ fontSize: "0.75rem", color: "var(--success)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <LuCheck size={12} /> Completed
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>Task Delegator & Operations Board</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Real-time Kanban workflow, operational checklists, and volunteer task tracking.
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
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            <LuPlus size={16} /> New Task
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center" }}><div className="spinner"></div></div>
      ) : (
        /* KANBAN BOARD (3 COLUMNS) */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          
          {/* 1. PENDING COLUMN */}
          <div style={{ backgroundColor: "var(--bg-elevated)", borderRadius: "12px", padding: "16px", minHeight: "500px", border: "1px solid var(--border-light)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "var(--text-muted)" }} />
                Pending Dispatch
              </h3>
              <span className="badge">{pendingTasks.length}</span>
            </div>
            {pendingTasks.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px" }}>No pending tasks</div>
            ) : (
              pendingTasks.map(task => <TaskCard key={task.id} task={task} />)
            )}
          </div>

          {/* 2. IN PROGRESS COLUMN */}
          <div style={{ backgroundColor: "var(--bg-elevated)", borderRadius: "12px", padding: "16px", minHeight: "500px", border: "1px solid var(--border-light)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "var(--info)" }} />
                Underway / In Progress
              </h3>
              <span className="badge info">{inProgressTasks.length}</span>
            </div>
            {inProgressTasks.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px" }}>No tasks in progress</div>
            ) : (
              inProgressTasks.map(task => <TaskCard key={task.id} task={task} />)
            )}
          </div>

          {/* 3. COMPLETED COLUMN */}
          <div style={{ backgroundColor: "var(--bg-elevated)", borderRadius: "12px", padding: "16px", minHeight: "500px", border: "1px solid var(--border-light)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "var(--success)" }} />
                Completed
              </h3>
              <span className="badge success">{completedTasks.length}</span>
            </div>
            {completedTasks.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px" }}>No tasks completed yet</div>
            ) : (
              completedTasks.map(task => <TaskCard key={task.id} task={task} />)
            )}
          </div>

        </div>
      )}

      {/* CREATE TASK MODAL WITH TEMPLATES */}
      {isModalOpen && (
        <div className="modal-backdrop fade-in" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "520px" }}>
            <div className="modal-header">
              <h3>Dispatch Operational Task</h3>
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {/* Batch Task Templates */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: "700", color: "var(--text-secondary)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <LuSparkles size={14} color="var(--primary)" /> Quick Operational Templates:
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {TASK_TEMPLATES.map((tmpl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: "0.75rem", padding: "3px 8px", background: "var(--bg-secondary)" }}
                      onClick={() => applyTemplate(tmpl)}
                    >
                      {tmpl.title}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleCreateTask} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="form-group">
                  <label className="form-label">Task Title *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Inspect Stage 1 Fire Barrier"
                    value={newTask.title}
                    onChange={e => setNewTask({...newTask, title: e.target.value})}
                    required
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Sector / Zone</label>
                    <select
                      className="form-select"
                      value={newTask.zone_name}
                      onChange={e => setNewTask({...newTask, zone_name: e.target.value})}
                    >
                      <option value="">-- All Zones --</option>
                      {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Assignee</label>
                    <select
                      className="form-select"
                      value={newTask.assigned_to}
                      onChange={e => setNewTask({...newTask, assigned_to: e.target.value})}
                    >
                      <option value="">-- Unassigned (Broadcast) --</option>
                      {volunteers.map(v => (
                        <option key={v.id} value={v.volunteer_id}>
                          {v.volunteer?.full_name || v.volunteer_id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select
                      className="form-select"
                      value={newTask.priority}
                      onChange={e => setNewTask({...newTask, priority: e.target.value})}
                    >
                      <option value="routine">Routine</option>
                      <option value="high">High Priority</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Due At</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={newTask.due_at}
                      onChange={e => setNewTask({...newTask, due_at: e.target.value})}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Instructions / Description</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Specific protocols, equipment checklists..."
                    value={newTask.description}
                    onChange={e => setNewTask({...newTask, description: e.target.value})}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Dispatch Task</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
