# TODO - Phase 2 (Enterprise Booking)

## 1) Database (additive, backward compatible)
- [ ] Add `booking_number` column to `bookings` (nullable).
- [ ] Add tables: `booking_events`, `booking_assignments`.
- [ ] Add indexes for search/filter and analytics.

## 2) Enterprise booking domain
- [ ] Add repository layer:
  - [ ] BookingRepository (helpers for bookings)
  - [ ] BookingTimelineRepository
  - [ ] AssignmentRepository
  - [ ] EnterpriseBookingRepository
- [ ] Add service layer:
  - [ ] enterpriseBookingNumber (BTB-YYYY-000001 format)
  - [ ] enterpriseBookingValidation (status transition validation)
  - [ ] bookingLifecycleService (write events + update status atomically)
  - [ ] enterpriseBookingAnalyticsService

## 3) New APIs (additive routes)
- [ ] Create routes module(s):
  - [ ] `/api/enterprise/bookings/:bookingId/timeline` (GET)
  - [ ] `/api/enterprise/bookings/:bookingId/status` (GET)
  - [ ] `/api/enterprise/bookings/:bookingId/status` (POST, admin-only)
  - [ ] `/api/enterprise/bookings/history` (GET, customer-facing)
  - [ ] `/api/enterprise/bookings/search` (POST advanced filters)
  - [ ] `/api/enterprise/bookings/analytics` (GET admin)
  - [ ] `/api/enterprise/bookings/:bookingId/assign` (POST dispatcher/admin)
  - [ ] `/api/enterprise/bookings/assignable` (GET)

## 4) Transaction helper
- [ ] Implement sqlite transaction wrapper utility.

## 5) Tests
- [ ] Add Jest unit tests:
  - [ ] booking number generation format
  - [ ] status transition validation
  - [ ] timeline event insertion
  - [ ] search/filter query builder
- [ ] Run test suite.

## Completion
- [ ] Update this file with progress after each step.

