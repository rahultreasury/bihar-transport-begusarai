/**
 * tests/enquiryAdminDetail.db.test.js
 * ============================================================================
 * REGRESSION COVERAGE, against the real database — the layer that actually broke.
 *
 * The unit tests in enquiryAdminDetailRegression.test.js prove the DTO is safe.
 * This file proves the QUERY is safe: it runs the exact Prisma call that
 * produced `PrismaClientValidationError: Unknown field \`quotation\`` and the
 * exact controller call for enquiry 4470.
 *
 * Enquiry 4470 is READ ONLY. Nothing here creates, updates or deletes a record.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const enquiryService = require('../services/EnquiryService');
const eventService = require('../services/EnquiryEventService');
const { toAdminEnquiry } = require('../dtos/EnquiryDTO');

const TARGET_ENQUIRY_ID = 4470;

/** Resolve the Prisma client the service itself uses. */
function prisma() {
  return enquiryService.prisma;
}

async function skipUnlessDb(t) {
  try {
    await prisma().$queryRaw`SELECT 1`;
  } catch (e) {
    return t.skip(`database unavailable: ${e.message}`);
  }
  return null;
}

/* ========================================================================== */
test('the real enquiry findUnique for 4470 executes (the call that used to throw)', async (t) => {
  if (await skipUnlessDb(t)) return;

  const enquiry = await enquiryService.loadForAdmin(TARGET_ENQUIRY_ID);
  assert.ok(enquiry, `enquiry ${TARGET_ENQUIRY_ID} must exist`);
  assert.equal(enquiry.enquiry_id, TARGET_ENQUIRY_ID);
});

test(`enquiry ${TARGET_ENQUIRY_ID} loads and serialises for the admin workspace`, async (t) => {
  if (await skipUnlessDb(t)) return;

  const enquiry = await enquiryService.loadForAdmin(TARGET_ENQUIRY_ID);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: false });

  const dto = toAdminEnquiry(enquiry, events);
  assert.equal(dto.enquiry_id, TARGET_ENQUIRY_ID);
  assert.ok(dto.customer, 'the customer block is always present');
  assert.ok(Array.isArray(dto.events), 'events is always an array');
  // Optional relations render as empty states, never as a thrown error.
  assert.ok('driver' in dto.assignment);
  assert.ok('vehicle' in dto.assignment);
  assert.equal(typeof dto.commercial.has_order, 'boolean');
});

test(`the enquiry ${TARGET_ENQUIRY_ID} list query executes for admins`, async (t) => {
  if (await skipUnlessDb(t)) return;
  const result = await enquiryService.listForAdmin({});
  assert.ok(Array.isArray(result.rows || result), 'the admin list returns a collection');
});

test('a non-existent enquiry raises NotFound, never a validation error', async (t) => {
  if (await skipUnlessDb(t)) return;

  await assert.rejects(
    () => enquiryService.loadForAdmin(2147483647),
    (e) => {
      assert.equal(e.constructor.name, 'NotFoundError', `expected NotFoundError, got ${e.constructor.name}: ${e.message}`);
      return true;
    }
  );
});

test('an enquiry with events returns them, and an enquiry with none returns []', async (t) => {
  if (await skipUnlessDb(t)) return;

  const withEvents = await eventService.listEvents(TARGET_ENQUIRY_ID, { customerVisibleOnly: false });
  assert.ok(Array.isArray(withEvents), 'listEvents always returns an array');

  const without = await eventService.listEvents(2147483647, { customerVisibleOnly: false });
  assert.deepEqual(without, [], 'no events -> empty array, not null and not a throw');
});

test('a non-numeric id is rejected or resolved as a number, never silently coerced', async (t) => {
  if (await skipUnlessDb(t)) return;
  await assert.rejects(
    () => enquiryService.loadForAdmin('not-a-number'),
    (e) => {
      assert.notEqual(e.constructor.name, 'PrismaClientValidationError');
      return true;
    }
  );
});
