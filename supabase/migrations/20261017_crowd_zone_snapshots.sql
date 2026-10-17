-- ============================================================================
-- SPATIALLY — CROWD ZONE SNAPSHOTS & RETENTION
-- Purpose: Formal table definition for high-frequency zone headcount snapshots
-- used by the algorithmic overcrowding prediction engine.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crowd_zone_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES public.event_zones(id) ON DELETE CASCADE,
    estimated_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual_calibration', 'simulation', 'ble_telemetry')),
    notes TEXT,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Compound index for fast time-window slicing per event
CREATE INDEX IF NOT EXISTS idx_crowd_zone_snapshots_event_time 
    ON public.crowd_zone_snapshots (event_id, snapshot_at DESC);

-- Index for zone-level lookups
CREATE INDEX IF NOT EXISTS idx_crowd_zone_snapshots_zone 
    ON public.crowd_zone_snapshots (zone_id);

-- Enable RLS and establish event staff read/insert policy
ALTER TABLE public.crowd_zone_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'crowd_zone_snapshots' AND policyname = 'allow_authenticated_read_snapshots'
    ) THEN
        CREATE POLICY allow_authenticated_read_snapshots ON public.crowd_zone_snapshots
            FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'crowd_zone_snapshots' AND policyname = 'allow_authenticated_insert_snapshots'
    ) THEN
        CREATE POLICY allow_authenticated_insert_snapshots ON public.crowd_zone_snapshots
            FOR INSERT TO authenticated WITH CHECK (true);
    END IF;
END $$;
