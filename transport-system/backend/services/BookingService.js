const {
  formatOwnerBookingMessage,
  formatCustomerConfirmationMessage,
} = require('../utils/bookingMessageFormatter');

const { sendWhatsAppMessage } = require('./whatsappCloud');

/**
 * MVP: no DB writes.
 * This service is intentionally modular so MongoDB can be added later
 * without changing the API route contract.
 */
async function submitBooking(booking) {
  const ownerMessage = formatOwnerBookingMessage(booking);

  const ownerTo = process.env.WHATSAPP_BUSINESS_NUMBER;
  if (!ownerTo) {
    throw new Error('Missing WHATSAPP_BUSINESS_NUMBER env var');
  }

  console.log('[booking][whatsapp][request] owner ->', ownerTo);
  console.log('[booking][whatsapp][text] owner (preview):', ownerMessage.slice(0, 120));

  // MVP: send only to business owner
  await sendWhatsAppMessage({
    to: ownerTo,
    text: ownerMessage,
  });

  // Customer confirmation is behind a flag
  const enableCustomer = String(process.env.ENABLE_CUSTOMER_WHATSAPP || 'false') === 'true';
  if (enableCustomer) {
    const customerMessage = formatCustomerConfirmationMessage(booking);

    try {
      console.log('[booking][whatsapp][request] customer ->', booking.mobile);
      await sendWhatsAppMessage({
        to: booking.mobile,
        text: customerMessage,
      });
    } catch (err) {
      console.warn("[booking][customer] WhatsApp skipped:", err.message);
    }
  }
}

module.exports = {
  submitBooking,
};

