-- ============================================================================
-- SPATIALLY — PHASE 8B: RETIRE LEGACY WEB TABLES (CONTRACT STEP)
-- Migration: 20261002_phase8b_drop_legacy.sql
-- Description: Drops legacy prototype tables after full migration to canonical tables:
--              - volunteer_map_positions -> public.volunteer_shifts (zone_id)
--              - web_volunteer_assignments -> public.volunteer_assignments
--              - web_users -> auth.users + public.profiles
-- ============================================================================

-- 1. Drop volunteer_map_positions (replaced by volunteer_shifts with zone-based topology)
DROP TABLE IF EXISTS public.volunteer_map_positions CASCADE;

-- 2. Drop web_volunteer_assignments (replaced by canonical volunteer_assignments)
DROP TABLE IF EXISTS public.web_volunteer_assignments CASCADE;

-- 3. Drop web_users (replaced by Supabase Auth auth.users and public.profiles)
DROP TABLE IF EXISTS public.web_users CASCADE;
