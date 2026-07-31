function normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function formatOwnerBookingMessage(booking) {
  const pickup = normalize(booking.pickup);
  const drop = normalize(booking.drop);
  const vehicle = normalize(booking.vehicle);
  const distance = normalize(booking.distance);
  const price = normalize(booking.price);
  const customerName = normalize(booking.customerName);
  const mobile = normalize(booking.mobile);
  const goodsType = normalize(booking.goodsType);

  return [
    '📦 *New Transport Booking Request*',
    '',
    `👤 *Customer Name:* ${customerName}`,
    `📞 *Mobile:* ${mobile}`,
    `🏷️ *Goods Type:* ${goodsType}`,
    '',
    `📍 *Pickup:* ${pickup}`,
    `➡️ *Drop:* ${drop}`,
    `🚚 *Vehicle:* ${vehicle}`,
    `📏 *Distance:* ${distance} km`,
    `💰 *Price:* ₹${price}`,
    '',
    'Please contact the customer to confirm pickup and next steps.',
    '',
    '— Bihar Transport Begusarai',
  ].join('\n');
}

function formatCustomerConfirmationMessage(booking) {
  const pickup = normalize(booking.pickup);
  const drop = normalize(booking.drop);
  const vehicle = normalize(booking.vehicle);
  const distance = normalize(booking.distance);
  const price = normalize(booking.price);
  const goodsType = normalize(booking.goodsType);

  return [
    '✅ *Booking Received!*',
    '',
    `Pickup: ${pickup}`,
    `Drop: ${drop}`,
    `Vehicle: ${vehicle}`,
    `Goods Type: ${goodsType}`,
    `Distance: ${distance} km`,
    `Estimated Price: ₹${price}`,
    '',
    'Thank you for booking with *Bihar Transport Begusarai*. Our team will contact you shortly to confirm details.',
    '— Bihar Transport Begusarai',
  ].join('\n');
}

module.exports = {
  formatOwnerBookingMessage,
  formatCustomerConfirmationMessage,
};

