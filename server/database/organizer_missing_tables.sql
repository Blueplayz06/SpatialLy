-- Supabase SQL Migration to Create Missing Organizer Tables
-- Copy and run this script in your Supabase SQL Editor to resolve the "Failed to fetch" errors.

-- 1. Event Zones
CREATE TABLE IF NOT EXISTS event_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    floor_level INTEGER DEFAULT 1,
    capacity_limit INTEGER,
    operating_capacity INTEGER,
    is_crowd_monitored BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, name)
);

CREATE INDEX IF NOT EXISTS idx_event_zones_event ON event_zones(event_id);
ALTER TABLE event_zones DISABLE ROW LEVEL SECURITY;

-- 2. Booths
CREATE TABLE IF NOT EXISTS booths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    booth_number TEXT,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    category TEXT,
    contact_name TEXT,
    contact_email TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booths_event ON booths(event_id);
ALTER TABLE booths DISABLE ROW LEVEL SECURITY;

-- 3. Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    speaker_name TEXT,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    location TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    session_type TEXT DEFAULT 'presentation',
    status TEXT DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_id);
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;

-- 4. Supervisor Tasks
CREATE TABLE IF NOT EXISTS supervisor_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    zone_name TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    assigned_to TEXT,
    created_by TEXT,
    completion_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_event ON supervisor_tasks(event_id);
ALTER TABLE supervisor_tasks DISABLE ROW LEVEL SECURITY;

-- 5. Operational Incidents
CREATE TABLE IF NOT EXISTS operational_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'other',
    priority TEXT DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'critical')),
    status TEXT DEFAULT 'reported' CHECK (status IN ('reported', 'in_progress', 'resolved', 'closed')),
    venue_zone_name TEXT,
    reporter_id TEXT,
    assigned_to TEXT,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_event ON operational_incidents(event_id);
ALTER TABLE operational_incidents DISABLE ROW LEVEL SECURITY;

-- 6. Volunteer Shifts
CREATE TABLE IF NOT EXISTS volunteer_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    volunteer_id TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'no_show')),
    break_state TEXT DEFAULT 'working' CHECK (break_state IN ('working', 'taking_break')),
    start_time TIMESTAMPTZ DEFAULT now(),
    end_time TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shifts_event ON volunteer_shifts(event_id);
ALTER TABLE volunteer_shifts DISABLE ROW LEVEL SECURITY;

-- 7. Event Teams
CREATE TABLE IF NOT EXISTS event_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    lead_id TEXT,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_event ON event_teams(event_id);
ALTER TABLE event_teams DISABLE ROW LEVEL SECURITY;

-- 8. Coverage Requests
CREATE TABLE IF NOT EXISTS coverage_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    requester_id TEXT NOT NULL,
    zone TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
    fulfilled_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coverage_req_event ON coverage_requests(event_id);
ALTER TABLE coverage_requests DISABLE ROW LEVEL SECURITY;

-- 9. Operational Messages
CREATE TABLE IF NOT EXISTS operational_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    content TEXT NOT NULL,
    target_type TEXT DEFAULT 'broadcast' CHECK (target_type IN ('broadcast', 'team', 'zone', 'individual')),
    target_id TEXT,
    priority TEXT DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent')),
    requires_acknowledgment BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_event ON operational_messages(event_id);
ALTER TABLE operational_messages DISABLE ROW LEVEL SECURITY;

-- 10. Volunteer Counts
CREATE TABLE IF NOT EXISTS volunteer_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    zone TEXT NOT NULL,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    active_count INTEGER DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_counts_event ON volunteer_counts(event_id);
ALTER TABLE volunteer_counts DISABLE ROW LEVEL SECURITY;

-- 11. Lost and Found Reports
CREATE TABLE IF NOT EXISTS lost_found_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    reporter_id TEXT,
    item_type TEXT DEFAULT 'lost' CHECK (item_type IN ('lost', 'found')),
    description TEXT NOT NULL,
    location TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'matched', 'returned', 'closed')),
    contact_info TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lf_event ON lost_found_reports(event_id);
ALTER TABLE lost_found_reports DISABLE ROW LEVEL SECURITY;

-- 12. Crowd Zone Snapshots (Overcrowding Prediction History)
CREATE TABLE IF NOT EXISTS crowd_zone_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES event_zones(id) ON DELETE CASCADE,
    estimated_count INTEGER NOT NULL DEFAULT 0,
    source TEXT DEFAULT 'auto',
    notes TEXT,
    snapshot_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_czs_event_time ON crowd_zone_snapshots(event_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_czs_zone ON crowd_zone_snapshots(zone_id);
ALTER TABLE crowd_zone_snapshots DISABLE ROW LEVEL SECURITY;
