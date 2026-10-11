-- ============================================================================
-- Enquiry → Trip RESERVATION link.
--
-- WHY THIS EXISTS
--   Vehicle + driver are now assigned BEFORE the customer accepts the quote, so
--   the consignment needs an operational Trip while it is still only an enquiry.
--   `trips.booking_id` cannot carry that: the Booking is not created until the
--   customer accepts, which is exactly the moment we no longer need to make one.
--
-- WHAT IT IS
--   One nullable column plus a UNIQUE index. Nothing is backfilled and no
--   existing row changes, so this cannot alter any historical consignment.
--
--   • NULL            → an ordinary trip (unchanged behaviour everywhere)
--   • a value         → the trip that RESERVES resources for that enquiry
--
-- WHY UNIQUE
--   `trips.booking_id` is already the "exactly one trip per order" anchor. This
--   is the same guarantee one step earlier in the lifecycle: an enquiry can have
--   at most ONE reservation trip. The partial index (WHERE enquiry_id IS NOT
--   NULL) means the many trips with no enquiry are unaffected — uniqueness is
--   only enforced where it means something, which is what a plain UNIQUE column
--   on a nullable value would get wrong.
--
--   Provisioning is therefore duplicate-safe at the DATABASE level, not merely
--   at the application level: a concurrent double-click can fail the insert
--   rather than produce a second reservation trip.
--
--   There is no Prisma relation on this column on purpose. It is a scalar link
--   like `client_id`, used for lookup and idempotency only; adding a relation
--   would require a back-relation on Enquiry and a second thing to keep in
--   sync for no reader benefit.
-- ============================================================================

ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "enquiry_id" INTEGER;

-- The lookup path used by provisioning and by the acceptance hand-off.
CREATE INDEX IF NOT EXISTS "idx_trips_enquiry" ON "trips" ("enquiry_id");

-- At most ONE reservation trip per enquiry.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_trips_enquiry_reservation"
  ON "trips" ("enquiry_id")
  WHERE "enquiry_id" IS NOT NULL;