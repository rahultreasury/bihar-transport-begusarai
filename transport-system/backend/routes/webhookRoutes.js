const express = require('express');

const router = express.Router();

// WhatsApp Webhook Verification
router.get('/webhook', (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const verifyToken = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && verifyToken && expectedToken && verifyToken === expectedToken) {
      return res.status(200).send(String(challenge || ''));
    }

    return res.sendStatus(403);
  } catch (err) {
    // Never crash the server due to webhook verification issues
    return res.sendStatus(403);
  }
});

// WhatsApp Webhook Events
router.post('/webhook', (req, res) => {
  try {
    // Log incoming webhook payload (as received)
    console.log('[whatsapp][webhook][body]', JSON.stringify(req.body, null, 2));
  } catch (err) {
    // Ignore logging errors
  }

  // Return HTTP 200 immediately
  return res.sendStatus(200);
});

module.exports = router;

