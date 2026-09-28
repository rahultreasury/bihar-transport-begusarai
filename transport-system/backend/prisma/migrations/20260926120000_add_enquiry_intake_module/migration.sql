-- ============================================================
-- Enquiry intake module (pre-booking customer request)
-- ============================================================
-- Creates:
--   enquiries      — customer request + admin quote + acceptance record
--   enquiry_events — append-only audit trail / customer activity feed
--
-- Adds Enquiry.booking_id so the EXISTING bookings table becomes the
-- operational record of an accepted enquiry (Enquiry -> Booking -> Trip).
-- No existing table is dropped, renamed, or structurally changed: every
-- addition is nullable / additive, so all pre-existing rows stay valid.

-- --- Enums -------------------------------------------------------------
CREATE TYPE "EnquiryStatus" AS ENUM (
    'ENQUIRY_SUBMITTED',
    'ADMIN_REVIEW',
    'ASSIGNMENT_PENDING',
    'VEHICLE_ASSIGNED',
    'DRIVER_ASSIGNED',
    'QUOTE_READY',
    'AWAITING_CUSTOMER_ACCEPTANCE',
    'CUSTOMER_ACCEPTED',
    'CUSTOMER_REJECTED',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);

CREATE TYPE "EnquiryPriceStatus" AS ENUM (
    'NOT_QUOTED',
    'ESTIMATED',
    'QUOTED',
    'SENT',
    'ACCEPTED',
    'REJECTED',
    'CANCELLED'
);

CREATE TYPE "EnquiryActorType" AS ENUM (
    'CUSTOMER',
    'ADMIN',
    'DRIVER',
    'PARTNER',
    'SYSTEM'
);

CREATE TYPE "EnquiryEventType" AS ENUM (
    'ENQUIRY_CREATED',
    'ADMIN_VIEWED',
    'STATUS_CHANGED',
    'VEHICLE_ASSIGNED',
    'DRIVER_ASSIGNED',
    'PARTNER_ASSIGNED',
    'REASSIGNED',
    'QUOTE_CREATED',
    'QUOTE_SENT',
    'QUOTE_UPDATED',
    'CUSTOMER_ACCEPTED',
    'CUSTOMER_REJECTED',
    'CUSTOMER_CANCELLED',
    'DRIVER_REASSIGNMENT_REQUESTED',
    'DRIVER_ISSUE_REPORTED',
    'BOOKING_CREATED',
    'TRIP_LINKED',
    'NOTE_ADDED'
);

-- --- enquiries ---------------------------------------------------------
CREATE TABLE "enquiries" (
    "enquiry_id"                  SERIAL PRIMARY KEY,
    "enquiry_number"              TEXT NOT NULL,
    "customer_id"                 INTEGER,
    "customer_name"               TEXT NOT NULL,
    "customer_mobile"             TEXT NOT NULL,
    "customer_email"              TEXT,
    "session_key"                 TEXT,

    "pickup_location"             TEXT NOT NULL,
    "pickup_address"              TEXT,
    "pickup_latitude"             DOUBLE PRECISION,
    "pickup_longitude"            DOUBLE PRECISION,
    "drop_location"               TEXT NOT NULL,
    "drop_address"                TEXT,
    "drop_latitude"               DOUBLE PRECISION,
    "drop_longitude"              DOUBLE PRECISION,
    "distance_km"                 DOUBLE PRECISION,

    "requested_vehicle_id"        INTEGER,
    "requested_vehicle_name"      TEXT,
    "assigned_vehicle_id"         INTEGER,
    "assigned_driver_id"          INTEGER,
    "assigned_partner_id"         INTEGER,
    "assigned_owner_id"           INTEGER,
    "assigned_vehicle_number"     TEXT,
    "assigned_vehicle_type"       TEXT,
    "assigned_driver_name"        TEXT,
    "driver_assigned_at"          TIMESTAMP(3),
    "vehicle_assigned_at"         TIMESTAMP(3),

    "material"                    TEXT NOT NULL,
    "quantity"                    DOUBLE PRECISION,
    "quantity_unit"               TEXT,
    "weight"                      DOUBLE PRECISION,
    "weight_unit"                 TEXT,
    "goods_category"              TEXT,
    "fragile"                     BOOLEAN NOT NULL DEFAULT false,
    "special_instructions"        TEXT,

    "pickup_date"                 TIMESTAMP(3) NOT NULL,
    "pickup_time"                 TEXT NOT NULL,

    "estimated_price_min"         DOUBLE PRECISION,
    "estimated_price_max"         DOUBLE PRECISION,
    "final_quoted_price"          DOUBLE PRECISION,
    "price_status"                "EnquiryPriceStatus" NOT NULL DEFAULT 'NOT_QUOTED',
    "quote_remarks"               TEXT,
    "quoted_by_admin_id"          INTEGER,
    "quoted_at"                   TIMESTAMP(3),

    "status"                      "EnquiryStatus" NOT NULL DEFAULT 'ENQUIRY_SUBMITTED',
    "accepted_at"                 TIMESTAMP(3),
    "rejected_at"                 TIMESTAMP(3),
    "cancelled_at"                TIMESTAMP(3),
    "cancellation_reason"         TEXT,
    "confirmed_at"                TIMESTAMP(3),
    "started_at"                  TIMESTAMP(3),
    "completed_at"                TIMESTAMP(3),

    "booking_id"                  INTEGER,

    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- --- enquiry_events ----------------------------------------------------
CREATE TABLE "enquiry_events" (
    "enquiry_event_id"  SERIAL PRIMARY KEY,
    "enquiry_id"        INTEGER NOT NULL,
    "event_type"        "EnquiryEventType" NOT NULL,
    "actor_type"        "EnquiryActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_id"          INTEGER,
    "actor_name"        TEXT,
    "message"           TEXT NOT NULL,
    "metadata"          JSONB,
    "customer_visible"  BOOLEAN NOT NULL DEFAULT true,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- --- Indexes -----------------------------------------------------------
CREATE UNIQUE INDEX "idx_enquiries_number"        ON "enquiries"("enquiry_number");
CREATE INDEX "idx_enquiries_customer"           ON "enquiries"("customer_id");
CREATE INDEX "idx_enquiries_booking"            ON "enquiries"("booking_id");
CREATE INDEX "idx_enquiries_mobile"             ON "enquiries"("customer_mobile");
CREATE INDEX "idx_enquiries_session"            ON "enquiries"("session_key");
CREATE INDEX "idx_enquiries_status"             ON "enquiries"("status");
CREATE INDEX "idx_enquiries_price_status"       ON "enquiries"("price_status");
CREATE INDEX "idx_enquiries_driver"             ON "enquiries"("assigned_driver_id");
CREATE INDEX "idx_enquiries_vehicle"            ON "enquiries"("assigned_vehicle_id");
CREATE INDEX "idx_enquiries_partner"            ON "enquiries"("assigned_partner_id");
CREATE INDEX "idx_enquiries_pickup_date"        ON "enquiries"("pickup_date");
CREATE INDEX "idx_enquiries_created"            ON "enquiries"("created_at");

CREATE UNIQUE INDEX "enquiries_booking_id_key"   ON "enquiries"("booking_id");

CREATE INDEX "idx_enquiry_events_enquiry"        ON "enquiry_events"("enquiry_id", "created_at");
CREATE INDEX "idx_enquiry_events_type"          ON "enquiry_events"("event_type");
CREATE INDEX "idx_enquiry_events_created"       ON "enquiry_events"("created_at");

-- --- Foreign keys ------------------------------------------------------
ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_customer_id_fkey"
        FOREIGN KEY ("customer_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_requested_vehicle_id_fkey"
        FOREIGN KEY ("requested_vehicle_id") REFERENCES "transport_vehicles"("vehicle_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_assigned_vehicle_id_fkey"
        FOREIGN KEY ("assigned_vehicle_id") REFERENCES "transport_vehicles"("vehicle_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_assigned_driver_id_fkey"
        FOREIGN KEY ("assigned_driver_id") REFERENCES "drivers"("driver_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_assigned_partner_id_fkey"
        FOREIGN KEY ("assigned_partner_id") REFERENCES "partners"("partner_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_assigned_owner_id_fkey"
        FOREIGN KEY ("assigned_owner_id") REFERENCES "vehicle_owners"("owner_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_quoted_by_admin_id_fkey"
        FOREIGN KEY ("quoted_by_admin_id") REFERENCES "admins"("admin_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiries"
    ADD CONSTRAINT "enquiries_booking_id_fkey"
        FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enquiry_events"
    ADD CONSTRAINT "enquiry_events_enquiry_id_fkey"
        FOREIGN KEY ("enquiry_id") REFERENCES "enquiries"("enquiry_id")
        ON DELETE CASCADE ON UPDATE CASCADE;
