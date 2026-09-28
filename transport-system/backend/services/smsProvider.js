/**
 * smsProvider.js
 * SMS Provider Abstraction Layer
 *
 * Architecture:
 *   OtpService
 *       ↓
 *   SmsProvider (this module)
 *       ↓
 *   DevProvider / Msg91Provider / TwoFactorProvider / etc.
 *
 * Environment Variables:
 *   SMS_PROVIDER=dev|msg91|2factor
 *   SMS_API_KEY=xxx
 *   SMS_SENDER_ID=BTINFO
 *   SMS_TEMPLATE_ID=xxx (for MSG91/2Factor)
 *
 * In development mode (SMS_PROVIDER=dev or NODE_ENV=development without provider),
 * OTPs are logged to console instead of being sent via SMS.
 */

const axios = require('axios');
const { logger } = require('../utils/logger');

// ============================================================
// Base Provider Interface
// ============================================================

class SmsProvider {
  /**
   * Send an SMS message
   * @param {string} phone - Normalized 10-digit Indian mobile number
   * @param {string} message - Message content
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async send(phone, message) {
    throw new Error('send() must be implemented by subclass');
  }

  /**
   * Get provider name for logging
   * @returns {string}
   */
  getName() {
    return this.constructor.name;
  }
}

// ============================================================
// Development Provider (logs to console, never sends real SMS)
// ============================================================

class DevSmsProvider extends SmsProvider {
  async send(phone, message) {
    // Extract OTP from message for dev logging
    const otpMatch = message.match(/\b(\d{6})\b/);
    const otp = otpMatch ? otpMatch[1] : 'UNKNOWN';
    const isProd = process.env.NODE_ENV === 'production';

    // Log in a clearly marked dev format — NEVER in production
    if (!isProd) {
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║  [DEV OTP] SMS would be sent (development mode)             ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log(`║  Phone: ${phone.padEnd(50)} ║`);
      console.log(`║  OTP:   ${otp.padEnd(50)} ║`);
      console.log(`║  Message: ${message.substring(0, 50).padEnd(50)} ║`);
      console.log('╚══════════════════════════════════════════════════════════════╝\n');
    }

    // Structured logging — OTP is ALWAYS redacted (defense in depth)
    logger.info({
      provider: 'dev',
      phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'), // Mask middle digits
      otp: '[REDACTED]',
    }, 'dev_sms_sent');

    return { success: true, messageId: `dev-${Date.now()}` };
  }
}

// ============================================================
// MSG91 Provider
// ============================================================

class Msg91Provider extends SmsProvider {
  constructor() {
    super();
    this.apiKey = process.env.SMS_API_KEY;
    this.senderId = process.env.SMS_SENDER_ID || 'BTINFO';
    this.templateId = process.env.SMS_TEMPLATE_ID;
    this.baseUrl = 'https://api.msg91.com/api/v5/flow';
  }

  async send(phone, message) {
    if (!this.apiKey) {
      throw new Error('MSG91: SMS_API_KEY not configured');
    }
    if (!this.templateId) {
      throw new Error('MSG91: SMS_TEMPLATE_ID not configured');
    }

    // MSG91 expects phone in international format (91XXXXXXXXXX)
    const formattedPhone = `91${phone}`;

    const payload = {
      flow_id: this.templateId,
      sender: this.senderId,
      mobiles: formattedPhone,
      // MSG91 flow API uses variables; we pass the OTP as a variable
      // The template should have a variable like {{otp}}
      VAR1: message.match(/\b(\d{6})\b/)?.[1] || '000000',
    };

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'authkey': this.apiKey,
        },
        timeout: 10000,
      });

      logger.info({
        provider: 'msg91',
        phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        messageId: response.data?.request_id || response.data?.message_id,
      }, 'sms_sent');

      return {
        success: true,
        messageId: response.data?.request_id || response.data?.message_id,
      };
    } catch (error) {
      logger.error({
        provider: 'msg91',
        phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        error: error.message,
        response: error.response?.data,
      }, 'sms_failed');

      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }
}

// ============================================================
// 2Factor.in Provider
// ============================================================

class TwoFactorProvider extends SmsProvider {
  constructor() {
    super();
    this.apiKey = process.env.SMS_API_KEY;
    this.templateName = process.env.SMS_TEMPLATE_NAME || 'OTP';
  }

  async send(phone, message) {
    if (!this.apiKey) {
      throw new Error('2Factor: SMS_API_KEY not configured');
    }

    const otp = message.match(/\b(\d{6})\b/)?.[1] || '000000';
    const url = `https://2factor.in/API/V1/${this.apiKey}/SMS/+91${phone}/${otp}/${this.templateName}`;

    try {
      const response = await axios.get(url, { timeout: 10000 });

      logger.info({
        provider: '2factor',
        phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        messageId: response.data?.Details,
      }, 'sms_sent');

      return {
        success: true,
        messageId: response.data?.Details,
      };
    } catch (error) {
      logger.error({
        provider: '2factor',
        phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        error: error.message,
        response: error.response?.data,
      }, 'sms_failed');

      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }
}

// ============================================================
// TextLocal Provider (alternative)
// ============================================================

class TextLocalProvider extends SmsProvider {
  constructor() {
    super();
    this.apiKey = process.env.SMS_API_KEY;
    this.senderId = process.env.SMS_SENDER_ID || 'BTINFO';
  }

  async send(phone, message) {
    if (!this.apiKey) {
      throw new Error('TextLocal: SMS_API_KEY not configured');
    }

    const url = 'https://api.textlocal.in/send/';
    const params = new URLSearchParams({
      apikey: this.apiKey,
      numbers: `91${phone}`,
      message: message,
      sender: this.senderId,
    });

    try {
      const response = await axios.post(url, params, { timeout: 10000 });

      logger.info({
        provider: 'textlocal',
        phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        messageId: response.data?.batch_id,
      }, 'sms_sent');

      return {
        success: true,
        messageId: response.data?.batch_id,
      };
    } catch (error) {
      logger.error({
        provider: 'textlocal',
        phone: phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        error: error.message,
        response: error.response?.data,
      }, 'sms_failed');

      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }
}

// ============================================================
// Provider Factory
// ============================================================

const PROVIDERS = {
  dev: DevSmsProvider,
  msg91: Msg91Provider,
  '2factor': TwoFactorProvider,
  textlocal: TextLocalProvider,
};

/**
 * Create SMS provider instance based on environment configuration
 * @returns {SmsProvider}
 */
function createSmsProvider() {
  const providerName = (process.env.SMS_PROVIDER || 'dev').toLowerCase();

  // In development, default to dev provider if no explicit provider set
  const isDev = process.env.NODE_ENV !== 'production';
  const useDev = isDev && !process.env.SMS_PROVIDER;

  const selectedProvider = useDev ? 'dev' : providerName;
  const ProviderClass = PROVIDERS[selectedProvider];

  if (!ProviderClass) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown SMS_PROVIDER: "${providerName}". Available: ${available}`);
  }

  const provider = new ProviderClass();
  logger.info({ provider: selectedProvider, isDev: useDev }, 'sms_provider_initialized');
  return provider;
}

// Singleton instance
let _smsProvider = null;

/**
 * Get the SMS provider singleton
 * @returns {SmsProvider}
 */
function getSmsProvider() {
  if (!_smsProvider) {
    _smsProvider = createSmsProvider();
  }
  return _smsProvider;
}

/**
 * Reset the provider singleton (for testing)
 */
function resetSmsProvider() {
  _smsProvider = null;
}

module.exports = {
  SmsProvider,
  DevSmsProvider,
  Msg91Provider,
  TwoFactorProvider,
  TextLocalProvider,
  createSmsProvider,
  getSmsProvider,
  resetSmsProvider,
};