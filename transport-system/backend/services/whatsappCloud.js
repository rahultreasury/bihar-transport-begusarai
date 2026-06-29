const axios = require('axios');

function normalizePhone(phone) {
  // WhatsApp Cloud API expects number in international format without '+'
  const s = String(phone || '').trim();
  if (!s) return '';
  return s.replace(/^\+/, '');
}

async function sendWhatsAppMessage({ to, text }) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken) throw new Error('Missing WHATSAPP_ACCESS_TOKEN env var');
  if (!phoneNumberId) throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID env var');

  const toNumber = normalizePhone(to);
  if (!toNumber) throw new Error('Missing/invalid WhatsApp recipient number');

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: toNumber,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  console.log('[WhatsApp] Sending to:', toNumber);

  if (process.env.NODE_ENV === 'development') {
    // Log request payload without secrets
    console.log('[whatsappCloud][api][request]', {
      url: url.replace(accessToken, '[token]'),
      phoneNumberId,
      to: toNumber,
      type: payload.type,
    });
  }

  let resp;
  try {
    console.log("========== WHATSAPP AUTH DEBUG ==========");
    console.log("Graph URL:", url);
    console.log("Phone Number ID:", process.env.WHATSAPP_PHONE_NUMBER_ID);
    console.log("Business Number:", process.env.WHATSAPP_BUSINESS_NUMBER);
    console.log(
      "Token Prefix:",
      process.env.WHATSAPP_ACCESS_TOKEN
        ? process.env.WHATSAPP_ACCESS_TOKEN.substring(0, 20)
        : "MISSING"
    );
    console.log(
      "Token Length:",
      process.env.WHATSAPP_ACCESS_TOKEN
        ? process.env.WHATSAPP_ACCESS_TOKEN.length
        : 0
    );

    console.log("========== WHATSAPP AUTH DEBUG (REQUEST) ==========");
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    console.log("Authorization header being created:", Boolean(headers.Authorization));
    const expectedGraphUrl = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
    console.log("Final URL before axios.post():", url);
    console.log("Expected Graph URL (v23.0/<PHONE_NUMBER_ID>/messages):", expectedGraphUrl);
    console.log("URL matches expected?:", url === expectedGraphUrl);

    resp = await axios.post(url, payload, {
      headers,
      timeout: 15000,
    });

    console.log("========== WHATSAPP SUCCESS RESPONSE ==========");
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error('========== WHATSAPP API ERROR ==========');
    if (err && err.response) {
      console.error('Status:', err.response.status);
      console.error(
        'Meta response data:',
        JSON.stringify(err.response.data, null, 2)
      );
    } else {
      console.error(err);
    }
    throw err;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[whatsappCloud][api][response]', resp.data);
  }
  return resp.data;

}

module.exports = {
  sendWhatsAppMessage,
};

