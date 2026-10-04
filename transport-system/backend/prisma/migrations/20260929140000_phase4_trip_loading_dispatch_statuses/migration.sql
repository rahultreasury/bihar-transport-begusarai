-- =====================================================================
-- Phase 4 — Trip operational lifecycle: LOADING → DOCUMENTS → DISPATCH
--
-- ADDITIVE ONLY. No existing row is modified, no historical status is
-- renamed, no data is deleted.
--
-- The operational lifecycle this adds:
--
--     ORDER CONFIRMED   → PENDING            (existing)
--     VEHICLE HIRED     → ASSIGNED           (existing)
--     TO LOADING POINT  → TO_LOADING_POINT   (added here)
--     AT LOADING POINT  → AT_LOADING_POINT   (added here)
--     LOADED            → LOADED             (added here)
--     DISPATCHED        → DISPATCHED         (added here)
--     IN TRANSIT        → IN_TRANSIT         (existing)
--
-- WHY APPEND ONLY
--   `ALTER TYPE ... ADD VALUE` on PostgreSQL is the only backwards-safe way
--   to extend an enum that already has rows. Existing trips keep their exact
--   status: the live database holds PENDING (8), COMPLETED (4), IN_TRANSIT (3)
--   and ASSIGNED (2) — none of these values change meaning, and none of them
--   is removed or renamed. DELIVERED and CANCELLED are untouched.
--
--   The new values are appended at the END of the enum, so every existing
--   enum sort order (and therefore any code that orders by the raw enum) is
--   unchanged for the pre-existing values.
--
-- PRODUCTION SAFETY
--   `ADD VALUE` takes a brief ACCESS EXCLUSIVE lock on the type but does not
--   rewrite or scan `trips`. Safe to run online with `prisma migrate deploy`.
-- =====================================================================

DO $$
BEGIN
    -- TO LOADING POINT — vehicle has left for the loading point.
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'TripStatus' AND e.enumlabel = 'TO_LOADING_POINT'
    ) THEN
        ALTER TYPE "TripStatus" ADD VALUE 'TO_LOADING_POINT';
    END IF;

    -- AT LOADING POINT — vehicle has arrived and is waiting.
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'TripStatus' AND e.enumlabel = 'AT_LOADING_POINT'
    ) THEN
        ALTER TYPE "TripStatus" ADD VALUE 'AT_LOADING_POINT';
    END IF;

    -- LOADED — loading has actually finished. The operational status and the
    -- document readiness remain SEPARATE concepts (see the trip_documents
    -- table added by the next migration).
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'TripStatus' AND e.enumlabel = 'LOADED'
    ) THEN
        ALTER TYPE "TripStatus" ADD VALUE 'LOADED';
    END IF;

    -- DISPATCHED — the vehicle has left the loading point. This is the state
    -- that precedes IN_TRANSIT.
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'TripStatus' AND e.enumlabel = 'DISPATCHED'
    ) THEN
        ALTER TYPE "TripStatus" ADD VALUE 'DISPATCHED';
    END IF;
END $$;
