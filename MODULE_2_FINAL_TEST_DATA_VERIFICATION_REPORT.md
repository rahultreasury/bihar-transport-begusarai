# MODULE 2 FINAL TEST DATA VERIFICATION REPORT

**Date:** 2026-10-31  
**Status:** READ-ONLY VERIFICATION - NO CHANGES MADE  
**Database:** bihar_transport_begusarai (localhost:5432) - **CONFIRMED LOCAL DEVELOPMENT**  
**Scope:** All 29 active conflicting trips remaining after Batch A  
**Rule:** No trip classified as "safe to delete" based solely on name/reference. Financials/documents/timeline/operations considered.

---

## Verification Summary

All 29 trips verified against DB (trips, bookings, enquiries, trip_payments, trip_documents, eway_bills, trip_timeline where relevant). Batch A (14,17,32,3897,6817) confirmed cancelled. Protected records verified intact.

---

## Trip-by-Trip Verification

| Trip ID | Trip # | Status | Vehicle/Driver | Booking/Enquiry | Customer/User | Payments/Invoice/Financial | POD/E-Way Bill/Docs | Timeline/Audit Notes | Naming/Testing Indicators | Operational Activity | Classification | Evidence Summary | Recommended Safe Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **11** | BTBT-2026-00001 | IN_TRANSIT | 1/1 | None | - | **YES - 5 trip_payments totaling ₹5500 (CLIENT_PAYMENT, PARTIAL)** | None visible | Exists (operational) | BTBT naming but has financials | In transit | **PROTECTED** | Has real financial transactions. Must never be modified. | **DO NOT TOUCH.** Preserve all payments, audit, history. |
| **20** | BTBT-2026-00002 | PENDING | 11/4 | None | user_id=1 | None | None | Minimal | BTBT batch, user_id=1, created same day as 21,22,25,30,31 | PENDING only | **CONFIRMED_TEST_DATA** | Batch creation pattern, test user, no deps/financials. | Cancel via TripOperationalService only with business approval. |
| **21** | BTBT-2026-00003 | PENDING | 11/4 | None | user_id=1 | None | None | Minimal | BTBT batch, user_id=1 | PENDING only | **CONFIRMED_TEST_DATA** | Batch creation pattern. | Cancel via TripOperationalService only with business approval. |
| **22** | BTBT-2026-00004 | PENDING | 11/4 | None | user_id=1 | None | None | Minimal | BTBT batch, user_id=1 | PENDING only | **CONFIRMED_TEST_DATA** | Batch creation pattern. | Cancel via TripOperationalService only with business approval. |
| **25** | BTBT-2026-00005 | PENDING | 11/4 | None | user_id=1 | None | None | Minimal | BTBT batch, user_id=1 | PENDING only | **CONFIRMED_TEST_DATA** | Batch creation pattern. | Cancel via TripOperationalService only with business approval. |
| **30** | BTBT-2026-00006 | PENDING | 11/4 | None | user_id=1 | None | None | Minimal | BTBT batch, user_id=1 | PENDING only | **CONFIRMED_TEST_DATA** | Batch creation pattern. | Cancel via TripOperationalService only with business approval. |
| **31** | BTBT-2026-00007 | PENDING | 11/4 | None | user_id=1 | None | None | Minimal | BTBT batch, user_id=1 | PENDING only | **CONFIRMED_TEST_DATA** | Batch creation pattern. | Cancel via TripOperationalService only with business approval. |
| **1094** | BTBT-2026-00009 | LOADED | 4/3 | **Booking 203** (user 870) | user 870 | None found | None visible | Operational progression to LOADED | BTBT but has real booking/user, progressed operationally | LOADED (advanced) | **GENUINE_BUSINESS_DATA** | Has confirmed booking, progressed to LOADED, real user - operationally genuine. | **PRESERVE.** Needs reassignment strategy (Business+Ops). Do not cancel. |
| **1281** | BTBT-2026-00012 | ASSIGNED | 1/2 | **Booking 45** (user 38) | user 38 | None found | None | Minimal | BTBT batch created with 1282-1287,1288-style groupings | ASSIGNED only | **LIKELY_TEST_DATA** | Batch pattern + no financials, but has booking. Needs business review. | **HOLD.** Business approval required before action. |
| **1282** | BTBT-2026-00013 | ASSIGNED | 1/1 | **Booking 46** (user 39) | user 39 | None found | None | Minimal | BTBT batch | ASSIGNED only | **LIKELY_TEST_DATA** | Batch pattern, no financials, has booking. | **HOLD.** Business approval required. |
| **1283** | BTBT-2026-00014 | ASSIGNED | 1/1 | **Booking 47** (user 40) | user 40 | None found | None | Minimal | BTBT batch | ASSIGNED only | **LIKELY_TEST_DATA** | Batch pattern, no financials, has booking. | **HOLD.** Business approval required. |
| **1284** | BTBT-2026-00015 | ASSIGNED | 1/1 | **Booking 48** (user 39) | user 39 | None found | None | Minimal | BTBT batch | ASSIGNED only | **LIKELY_TEST_DATA** | Batch pattern, no financials, has booking. | **HOLD.** Business approval required. |
| **1285** | BTBT-2026-00016 | ASSIGNED | 4/3 | **Booking 49** (user 29) | user 29 | None found | None | Minimal | BTBT but has booking, real user | ASSIGNED only | **GENUINE_BUSINESS_DATA** | Has confirmed booking, real user - likely genuine business. | **PRESERVE.** Needs reassignment (Business+Ops). Do not cancel. |
| **1286** | BTBT-2026-00017 | ASSIGNED | 1/1 | **Booking 173** (user 4) | user 4 | None found | None | Minimal | BTBT batch, user 4 also linked to HTTP tests | ASSIGNED only | **LIKELY_TEST_DATA** | Mixed signals (batch + user linked to tests), no financials. | **HOLD.** Business approval required. |
| **1287** | BTBT-2026-00018 | ASSIGNED | 1/1 | **Booking 186** (user 820) | user 820 | None found | None | Minimal | BTBT batch | ASSIGNED only | **LIKELY_TEST_DATA** | Batch pattern, no financials, has booking. | **HOLD.** Business approval required. |
| **1545** | BTBT-2026-00019 | ASSIGNED | 1/1 | **Enquiry 4071** (no booking) | - | None found | None | Minimal | BTBT batch, enquiry only | ASSIGNED only | **LIKELY_TEST_DATA** | Batch pattern, enquiry-only, no booking/financials. | **HOLD.** Business approval required. |
| **1638** | BTBT-2026-00020 | ASSIGNED | 11/4 | **Enquiry 4470** (no booking), freight 0 | - | None found | None | Minimal | BTBT batch, zero freight, enquiry-only | ASSIGNED only | **LIKELY_TEST_DATA** | Strong test indicators (zero freight), enquiry-only. | **HOLD.** Business approval required. |
| **4142** | BTBT-2026-00035 | AT_LOADING_POINT | 4976/3069 | **Enquiry 12706** (no booking) | - | None found | None visible | Progressed to AT_LOADING_POINT | BTBT but progressed operationally | AT_LOADING_POINT (advanced) | **GENUINE_BUSINESS_DATA** | Progressed operationally despite no booking found - needs ops review. | **PRESERVE.** Needs reassignment (Business+Ops). Do not cancel. |
| **4264** | BTBT-2026-00037 | ASSIGNED | 4976/3069 | **Booking 2224** (user 768) | user 768 | None found | None visible | Operational state | BTBT with confirmed booking, real user | ASSIGNED with booking | **GENUINE_BUSINESS_DATA** | Has confirmed booking, progressed - likely genuine. | **PRESERVE.** Needs reassignment (Business+Ops). Do not cancel. |
| **5610** | PH6-HTTP-mvgfr2sf | IN_TRANSIT | 1/1 | None (user 4) | user 4 | None found | **POD doc 3742 PRESENT** (/uploads/pod/http-1.jpg, missing from disk) | Operational | PH6-HTTP test naming, user 4 linked to tests | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HTTP test naming, no booking/financials. Has POD doc requiring ops approval. | **HOLD - REQUIRES INDEPENDENT OPERATIONS APPROVAL.** Preserve doc 3742. Do not cancel without ops approval. |
| **7480** | HA-TRIP-305028 | IN_TRANSIT | 1/7190 | **Booking 4738 (HA-BK-305028, confirmed)** | user 9150 | None found | None | Operational | HA-TRIP automation naming, confirmed booking | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test naming. Confirmed booking but no financials - treat as test per pattern; needs business+ops approval for both. | **HOLD.** Business+Ops approval required for trip and/or booking (independent). |
| **14149** | HA-TRIP-366398 | IN_TRANSIT | 1/13859 | **Booking 8158 (HA-BK-366398, confirmed)** | user 19581 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **14461** | HA-TRIP-132552 | IN_TRANSIT | 1/14171 | **Booking 8318 (HA-BK-132552, confirmed)** | user 20069 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **15542** | HA-TRIP-658656 | IN_TRANSIT | 1/15244 | **Booking 8769 (HA-BK-658656, confirmed)** | user 21727 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **16595** | HA-TRIP-449247 | IN_TRANSIT | 1/16297 | **Booking 9309 (HA-BK-449247, confirmed)** | user 23374 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **16862** | HA-TRIP-139644 | IN_TRANSIT | 1/16531 | **Booking 9429 (HA-BK-139644, confirmed)** | user 23740 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **17406** | HA-TRIP-727098 | IN_TRANSIT | 1/17077 | **Booking 9709 (HA-BK-727098, confirmed)** | user 24594 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **18063** | HA-TRIP-266371 | IN_TRANSIT | 1/17738 | **Booking 10032 (HA-BK-266371, confirmed)** | user 25630 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |
| **18401** | HA-TRIP-891934 | IN_TRANSIT | 1/18077 | **Booking 10159 (HA-BK-891934, confirmed)** | user 26165 | None found | None | Operational | HA-TRIP automation naming | IN_TRANSIT | **CONFIRMED_TEST_DATA** | HA automation test pattern. | **HOLD.** Business+Ops approval required (independent). |

---

## Classification Summary

| Classification | Count | Trip IDs | Notes |
|---|---|---|---|
| **PROTECTED** | 1 | 11 | ₹5500 in 5 payments - never modify |
| **CONFIRMED_TEST_DATA** | 16 | 20,21,22,25,30,31,5610,7480,14149,14461,15542,16595,16862,17406,18063,18401 | Clear test indicators (batch/HTTP/HA automation). Some have deps needing approval. |
| **LIKELY_TEST_DATA** | 8 | 1281,1282,1283,1284,1286,1287,1545,1638 | Batch pattern or enquiry-only/zero freight; no financials. Need business review. |
| **GENUINE_BUSINESS_DATA** | 4 | 1094, 1285, 4142, 4264 | Have bookings/enquiries and operational progression. Likely genuine - need reassignment, not cancellation. |
| **NEEDS_MANUAL_REVIEW** | 0 | - | All classified. |

---

## Protected Records Reminder
- **Trip 11** and its **five payments totalling ₹5,500** - DO NOT MODIFY
- **Trip 32 E-Way Bill** and audit history - DO NOT MODIFY (already cancelled in Batch A)
- **Batch A cancellation history** (14,17,32,3897,6817) - DO NOT MODIFY
- **POD record 3742** for Trip 5610 - DO NOT MODIFY until retention requirements addressed (preserve DB record)

**CONFIRMATION:** This is a read-only verification. **No database or application changes were made.** No trips cancelled, no bookings cancelled, no resources reassigned, no records updated/deleted, no migration files modified, no migrations run. All classifications based on evidence from reports and DB inspection.
