-- Pre-repair backup 2026-08-05T04-07-30-671Z

-- users: 11 rows
INSERT INTO "users" SELECT * FROM "users" /* backup snapshot of 11 rows */;
-- drivers: 4 rows
INSERT INTO "drivers" SELECT * FROM "drivers" /* backup snapshot of 4 rows */;
-- bookings: 6 rows
INSERT INTO "bookings" SELECT * FROM "bookings" /* backup snapshot of 6 rows */;
-- deliveries: 6 rows
INSERT INTO "deliveries" SELECT * FROM "deliveries" /* backup snapshot of 6 rows */;
-- booking_assignments: 2 rows
INSERT INTO "booking_assignments" SELECT * FROM "booking_assignments" /* backup snapshot of 2 rows */;
-- booking_events: 0 rows
-- transport_vehicles: 1 rows
INSERT INTO "transport_vehicles" SELECT * FROM "transport_vehicles" /* backup snapshot of 1 rows */;
-- partners: 3 rows
INSERT INTO "partners" SELECT * FROM "partners" /* backup snapshot of 3 rows */;
-- partner_ledger: 0 rows
-- partner_payments: 0 rows
-- settlements: 0 rows
-- partner_documents: 0 rows
-- driver_assignments: 0 rows
-- driver_transactions: 38 rows
INSERT INTO "driver_transactions" SELECT * FROM "driver_transactions" /* backup snapshot of 38 rows */;
-- driver_timeline: 36 rows
INSERT INTO "driver_timeline" SELECT * FROM "driver_timeline" /* backup snapshot of 36 rows */;
-- admins: 1 rows
INSERT INTO "admins" SELECT * FROM "admins" /* backup snapshot of 1 rows */;
