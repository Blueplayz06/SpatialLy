-- ============================================================================
-- SPATIALLY — PHASE 8A: MISSING TABLES & SCHEMA EXTENSIONS
-- Migration: 20261002_phase8a_missing_tables.sql
-- Description: Creates 4 missing tables, extends profiles & venue_pois,
--              enforces NOT NULL on events.event_start_time/event_end_time.
-- All operations are idempotent (IF NOT EXISTS / IF NOT EXISTS guards).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CREATE TABLE: public.event_safety_resources
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_safety_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    resource_type TEXT NOT NULL DEFAULT 'equipment'
        CHECK (resource_type IN ('equipment', 'personnel', 'vehicle', 'communication', 'medical', 'other')),
    location TEXT,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    is_emergency_resource BOOLEAN NOT NULL DEFAULT false,
    guidance_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_event_safety_resources_event ON public.event_safety_resources(event_id);
CREATE INDEX IF NOT EXISTS idx_event_safety_resources_emergency ON public.event_safety_resources(event_id, is_emergency_resource);

ALTER TABLE public.event_safety_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view safety resources" ON public.event_safety_resources;
CREATE POLICY "Public can view safety resources"
ON public.event_safety_resources FOR SELECT USING (true);

DROP POLICY IF EXISTS "Organizers can manage safety resources" ON public.event_safety_resources;
CREATE POLICY "Organizers can manage safety resources"
ON public.event_safety_resources FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('organizer', 'admin')
    )
);

-- ----------------------------------------------------------------------------
-- 2. CREATE TABLE: public.event_emergency_contacts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    role TEXT,
    phone TEXT,
    email TEXT,
    priority_order INTEGER NOT NULL DEFAULT 1 CHECK (priority_order > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_event_emergency_contacts_event ON public.event_emergency_contacts(event_id, priority_order);

ALTER TABLE public.event_emergency_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view emergency contacts" ON public.event_emergency_contacts;
CREATE POLICY "Authenticated users can view emergency contacts"
ON public.event_emergency_contacts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Organizers can manage emergency contacts" ON public.event_emergency_contacts;
CREATE POLICY "Organizers can manage emergency contacts"
ON public.event_emergency_contacts FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('organizer', 'admin')
    )
);

-- ----------------------------------------------------------------------------
-- 3. CREATE TABLE: public.intelligence_recommendations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.intelligence_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    recommendation_type TEXT NOT NULL DEFAULT 'operational'
        CHECK (recommendation_type IN ('crowd', 'safety', 'staffing', 'operational', 'other')),
    message TEXT NOT NULL CHECK (char_length(trim(message)) > 0),
    confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    zone_id UUID REFERENCES public.event_zones(id) ON DELETE SET NULL,
    is_actioned BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_intelligence_recommendations_event ON public.intelligence_recommendations(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_recommendations_zone ON public.intelligence_recommendations(zone_id);

ALTER TABLE public.intelligence_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view recommendations" ON public.intelligence_recommendations;
CREATE POLICY "Organizers can view recommendations"
ON public.intelligence_recommendations FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('organizer', 'admin')
    )
);

DROP POLICY IF EXISTS "System can insert recommendations" ON public.intelligence_recommendations;
CREATE POLICY "System can insert recommendations"
ON public.intelligence_recommendations FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('organizer', 'admin')
    )
);

-- ----------------------------------------------------------------------------
-- 4. CREATE TABLE: public.intelligence_crowd_forecasts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.intelligence_crowd_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES public.event_zones(id) ON DELETE SET NULL,
    forecast_time TIMESTAMPTZ NOT NULL,
    predicted_count INTEGER NOT NULL CHECK (predicted_count >= 0),
    confidence_low INTEGER CHECK (confidence_low IS NULL OR confidence_low >= 0),
    confidence_high INTEGER CHECK (confidence_high IS NULL OR confidence_high >= 0),
    model_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_intelligence_crowd_forecasts_event_time ON public.intelligence_crowd_forecasts(event_id, forecast_time);
CREATE INDEX IF NOT EXISTS idx_intelligence_crowd_forecasts_zone ON public.intelligence_crowd_forecasts(zone_id);

ALTER TABLE public.intelligence_crowd_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view crowd forecasts" ON public.intelligence_crowd_forecasts;
CREATE POLICY "Organizers can view crowd forecasts"
ON public.intelligence_crowd_forecasts FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('organizer', 'admin')
    )
);

-- ----------------------------------------------------------------------------
-- 5. EXTEND TABLE: public.profiles — add organization_id, staff_permissions
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS staff_permissions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_profiles_organization ON public.profiles(organization_id);

-- ----------------------------------------------------------------------------
-- 6. EXTEND TABLE: public.venue_pois — add is_emergency_resource, guidance_text
-- (columns may not exist if venue_pois was created before this migration)
-- ----------------------------------------------------------------------------
ALTER TABLE public.venue_pois
    ADD COLUMN IF NOT EXISTS is_emergency_resource BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS guidance_text TEXT;

CREATE INDEX IF NOT EXISTS idx_venue_pois_emergency ON public.venue_pois(is_emergency_resource);

-- ----------------------------------------------------------------------------
-- 7. ENFORCE NOT NULL on events.event_start_time / event_end_time
-- (columns were added as nullable in phase4b — backfill then enforce)
-- ----------------------------------------------------------------------------

-- Step 1: Backfill NULL values so the NOT NULL constraint can be applied
UPDATE public.events
SET event_start_time = created_at
WHERE event_start_time IS NULL;

UPDATE public.events
SET event_end_time = COALESCE(event_start_time, created_at) + INTERVAL '4 hours'
WHERE event_end_time IS NULL;

-- Step 2: Enforce NOT NULL
ALTER TABLE public.events
    ALTER COLUMN event_start_time SET NOT NULL,
    ALTER COLUMN event_end_time SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. Enable Realtime on new tables
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Add new tables to realtime publication if it exists
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- event_safety_resources
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
            AND tablename = 'event_safety_resources'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.event_safety_resources;
        END IF;
        -- intelligence_recommendations
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
            AND tablename = 'intelligence_recommendations'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.intelligence_recommendations;
        END IF;
    END IF;
END $$;
