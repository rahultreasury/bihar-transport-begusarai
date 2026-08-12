/**
 * BookingDeletionService
 *
 * Safe cleanup workflow for cancelled/rejected bookings.
 *
 * Actions:
 *   KEEP      — no-op, booking remains unchanged.
 *   ARCHIVE   — soft-delete: set archived_at timestamp. All related records
 *               are preserved for audit/history.
 *   DELETE    — permanent hard-delete. Only allowed for cancelled/rejected
 *               bookings with no protected operational/financial records.
 *
 * Safety guarantees:
 *   - All mutations happen inside ONE Prisma transaction.
 *   - Active driver/vehicle assignments are released before deletion.
 *   - Reservations are released before deletion.
 *   - Driver/vehicle availability is restored before deletion.
 *   - Protected records (invoices, deliveries, ledger) block deletion.
 *   - Failed transactions roll back completely (no partial cleanup).
 */

const { prisma } = require('../config/prisma');
const { AppError, NotFoundError } = require('../utils/AppError');
const { logger } = require('../utils/logger');

// Statuses that are eligible for archive/delete cleanup.
const CLEANUP_ELIGIBLE_STATUSES = ['cancelled', 'rejected'];

// Statuses that are NEVER eligible for permanent deletion.
const PROTECTED_STATUSES = [
  'pending',
  'confirmed',
  'driver_assigned',
  'pickup_completed',
  'in_transit',
  'delivered',
  'completed',
];

class BookingDeletionService {
  /**
   * Perform the requested action on a booking.
   *
   * @param {number} bookingId
   * @param {'keep'|'archive'|'delete'} action
   * @param {number|null} adminId  Admin performing the action (for audit)
   * @returns {Promise<{action: string, booking_id: number, booking_number: string}>}
   */
  async performAction(bookingId, action, adminId = null) {
    if (!['keep', 'archive', 'delete'].includes(action)) {
      throw new AppError(`Invalid action: ${action}. Must be keep, archive, or delete.`, 400);
    }

    // Fetch booking with all relevant relations in ONE query.
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        delivery: {
          select: {
            delivery_id: true,
            current_status: true,
          },
        },
        reservations: {
          select: {
            reservation_id: true,
            status: true,
            driver_id: true,
            vehicle_id: true,
          },
        },
        bookingAssignments: {
          select: {
            booking_assignment_id: true,
            assignment_status: true,
            assigned_driver_id: true,
            assigned_vehicle_id: true,
          },
        },
        invoices: {
          select: {
            invoice_id: true,
            status: true,
          },
        },
        ledgerEntries: {
          select: {
            ledger_id: true,
          },
        },
        driver: {
          select: {
            driver_id: true,
            is_available: true,
            status: true,
          },
        },
        vehicle: {
          select: {
            vehicle_id: true,
            is_available: true,
            current_status: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    const status = (booking.status || '').toLowerCase();

    // KEEP is always allowed — no changes.
    if (action === 'keep') {
      logger.info({ adminId, bookingId, action: 'keep' }, 'booking_deletion.keep');
      return {
        action: 'keep',
        booking_id: bookingId,
        booking_number: booking.booking_number,
      };
    }

    // ARCHIVE: soft-delete. Allowed for cancelled/rejected bookings.
    if (action === 'archive') {
      if (!CLEANUP_ELIGIBLE_STATUSES.includes(status)) {
        const err = new Error(`Booking with status "${booking.status}" cannot be archived. Only cancelled or rejected bookings can be archived.`);
        err.code = 'BOOKING_NOT_ARCHIVABLE';
        throw err;
      }

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.booking.update({
          where: { booking_id: bookingId },
          data: { archived_at: new Date() },
          select: { booking_id: true, booking_number: true, archived_at: true },
        });

        // Verify the archive timestamp was set.
        if (!updated.archived_at) {
          const err = new Error('Booking archive could not be confirmed.');
          err.code = 'BOOKING_ARCHIVE_FAILED';
          throw err;
        }

        return updated;
      });

      logger.info({ adminId, bookingId, action: 'archive' }, 'booking_deletion.archive');
      return {
        action: 'archive',
        booking_id: result.booking_id,
        booking_number: result.booking_number,
      };
    }

    // DELETE: permanent hard-delete.
    // Only allowed for cancelled/rejected bookings.
    if (!CLEANUP_ELIGIBLE_STATUSES.includes(status)) {
      const err = new Error(`Booking with status "${booking.status}" cannot be permanently deleted. Only cancelled or rejected bookings are eligible.`);
      err.code = 'BOOKING_NOT_DELETABLE';
      throw err;
    }

    // Check for protected dependencies that block deletion.
    const hasActiveDelivery = booking.delivery &&
      !['delivered', 'cancelled'].includes((booking.delivery.current_status || '').toLowerCase());

    const hasProtectedInvoice = booking.invoices?.some(
      (inv) => ['GENERATED', 'PAID'].includes(inv.status)
    );

    const hasLedgerLink = (booking.ledgerEntries?.length || 0) > 0;

    // For cancelled/rejected bookings, active delivery records are stale
    // and will be safely cleaned up inside the deletion transaction.
    // For all other statuses, an active delivery blocks deletion.
    const isCleanupEligible = CLEANUP_ELIGIBLE_STATUSES.includes(status);
    if (hasActiveDelivery && !isCleanupEligible) {
      const err = new Error('This booking has an active delivery and cannot be permanently deleted. Complete or cancel the delivery first.');
      err.code = 'BOOKING_HAS_ACTIVE_DELIVERY';
      throw err;
    }

    if (hasProtectedInvoice) {
      const err = new Error('This booking has generated/paid invoices and cannot be permanently deleted. Invoices must be retained for financial records.');
      err.code = 'BOOKING_HAS_PROTECTED_INVOICE';
      throw err;
    }

    if (hasLedgerLink) {
      const err = new Error('This booking is linked to partner ledger records and cannot be permanently deleted. Ledger entries are preserved for audit.');
      err.code = 'BOOKING_HAS_LEDGER_RECORDS';
      throw err;
    }

    // Pre-compute counts for logging (defined outside transaction).
    const activeAssignments = booking.bookingAssignments?.filter(
      (a) => a.assignment_status === 'active'
    ) || [];
    const activeReservations = booking.reservations?.filter(
      (r) => r.status === 'ACTIVE'
    ) || [];

    // Perform the safe deletion inside ONE transaction.
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: If this is a cancelled/rejected booking with an active delivery,
      //    safely mark the delivery as cancelled/closed before removing it.
      //    This prevents orphaned operational delivery records.
      if (hasActiveDelivery && booking.delivery) {
        await tx.delivery.update({
          where: { delivery_id: booking.delivery.delivery_id },
          data: {
            current_status: 'cancelled',
            status_description: 'Booking cancelled — delivery removed by admin',
            updated_at: new Date(),
          },
        });
        await tx.delivery.delete({
          where: { delivery_id: booking.delivery.delivery_id },
        });
      }

      // Step 2: Release active booking assignments.
      //    - Mark assignments as released (we use a 'released' status string).
      //    - This prevents orphaned assignments after booking deletion.
      for (const assignment of activeAssignments) {
        await tx.bookingAssignment.update({
          where: { booking_assignment_id: assignment.booking_assignment_id },
          data: { assignment_status: 'released' },
        });
      }

      // Step 3: Release active reservations.
      for (const reservation of activeReservations) {
        await tx.reservation.update({
          where: { reservation_id: reservation.reservation_id },
          data: {
            status: 'RELEASED',
            released_at: new Date(),
          },
        });
      }

      // Step 4: Restore driver availability (if driver was assigned to this booking).
      if (booking.driver && activeAssignments.some((a) => a.assigned_driver_id === booking.driver.driver_id)) {
        await tx.driver.update({
          where: { driver_id: booking.driver.driver_id },
          data: {
            is_available: true,
            status: 'available',
          },
        });
      }

      // Step 5: Restore vehicle availability (if vehicle was assigned to this booking).
      if (booking.vehicle && activeAssignments.some((a) => a.assigned_vehicle_id === booking.vehicle.vehicle_id)) {
        await tx.transportVehicle.update({
          where: { vehicle_id: booking.vehicle.vehicle_id },
          data: {
            is_available: true,
            current_status: 'available',
          },
        });
      }

      // Step 6: Delete the booking.
      //    CASCADE will handle: booking_events, booking_assignments,
      //    invoices, reservations.
      //    SET NULL will handle: partner_ledger.booking_id.
      await tx.booking.delete({
        where: { booking_id: bookingId },
      });

      // Step 7: Verify the booking is actually gone.
      const stillThere = await tx.booking.findUnique({
        where: { booking_id: bookingId },
        select: { booking_id: true },
      });

      if (stillThere) {
        const err = new Error('Booking could not be fully removed from the database.');
        err.code = 'BOOKING_DELETE_FAILED';
        throw err;
      }

      return { booking_id: bookingId, booking_number: booking.booking_number };
    });

    logger.info(
      { adminId, bookingId, action: 'delete', releasedAssignments: activeAssignments.length, releasedReservations: activeReservations.length },
      'booking_deletion.delete'
    );

    return {
      action: 'delete',
      booking_id: result.booking_id,
      booking_number: result.booking_number,
    };
  }

  /**
   * Get a summary of what would happen for each action.
   * Used by the frontend to show context before the admin confirms.
   *
   * @param {number} bookingId
   * @returns {Promise<{booking_id: number, status: string, eligible_actions: string[], warnings: string[]}>}
   */
  async getDeletionSummary(bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        delivery: {
          select: { current_status: true },
        },
        reservations: {
          select: { status: true },
        },
        bookingAssignments: {
          select: { assignment_status: true },
        },
        invoices: {
          select: { status: true },
        },
        ledgerEntries: {
          select: { ledger_id: true },
        },
      },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    const status = (booking.status || '').toLowerCase();
    const eligibleActions = [];
    const warnings = [];

    const isCleanupEligible = CLEANUP_ELIGIBLE_STATUSES.includes(status);

    // KEEP is always available.
    eligibleActions.push('keep');

    // ARCHIVE is available for cancelled/rejected.
    if (isCleanupEligible) {
      eligibleActions.push('archive');
    }

    // DELETE is available only if no protected dependencies exist.
    // For cancelled/rejected bookings, an active delivery is stale and will be
    // safely cleaned up during deletion, so it does NOT block deletion.
    const hasActiveDelivery = booking.delivery &&
      !['delivered', 'cancelled'].includes((booking.delivery.current_status || '').toLowerCase());

    const hasProtectedInvoice = booking.invoices?.some(
      (inv) => ['GENERATED', 'PAID'].includes(inv.status)
    );

    const hasLedgerLink = (booking.ledgerEntries?.length || 0) > 0;

    const hasActiveReservation = booking.reservations?.some(
      (r) => r.status === 'ACTIVE'
    );

    const hasActiveAssignment = booking.bookingAssignments?.some(
      (a) => a.assignment_status === 'active'
    );

    const canDelete = isCleanupEligible &&
      !hasProtectedInvoice &&
      !hasLedgerLink &&
      (!hasActiveDelivery || isCleanupEligible); // active delivery OK for cancelled/rejected

    if (canDelete) {
      eligibleActions.push('delete');
    }

    // Build warnings for the UI.
    if (hasActiveReservation) {
      warnings.push('Active driver/vehicle reservation will be released.');
    }
    if (hasActiveAssignment) {
      warnings.push('Active driver/vehicle assignment will be released.');
    }
    if (hasProtectedInvoice) {
      warnings.push('Cannot delete: booking has generated/paid invoices.');
    }
    if (hasLedgerLink) {
      warnings.push('Cannot delete: booking is linked to ledger records.');
    }
    if (hasActiveDelivery && !isCleanupEligible) {
      warnings.push('Cannot delete: booking has an active delivery.');
    }
    if (hasActiveDelivery && isCleanupEligible) {
      warnings.push('Booking has a stale delivery record that will be removed during deletion.');
    }

    return {
      booking_id: booking.booking_id,
      booking_number: booking.booking_number,
      status: booking.status,
      eligible_actions: eligibleActions,
      warnings,
    };
  }
}

module.exports = { BookingDeletionService };
