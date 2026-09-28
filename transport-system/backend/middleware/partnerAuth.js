/**
 * Partner Authentication Middleware
 * Resolves the authenticated Partner from the JWT User
 * 
 * Flow:
 * JWT -> req.user.user_id -> User -> PartnerApplication -> Partner
 */

const { prisma } = require('../config/prisma');

/**
 * Get the authenticated Partner for the current request
 * @param {Object} req - Express request object with req.user from protect middleware
 * @returns {Promise<Object|null>} Partner object or null if not found
 */
async function getAuthenticatedPartner(req) {
  if (!req.user || !req.user.user_id) {
    return null;
  }

  // User must have partner role
  if (req.user.role !== 'partner') {
    return null;
  }

  // Find the PartnerApplication that links this User to a Partner
  const application = await prisma.partnerApplication.findFirst({
    where: {
      user_id: req.user.user_id,
      status: 'approved',
      partner_id: { not: null }
    },
    select: {
      partner_id: true
    }
  });

  if (!application || !application.partner_id) {
    return null;
  }

  // Get the Partner record
  const partner = await prisma.partner.findUnique({
    where: { partner_id: application.partner_id },
    select: {
      partner_id: true,
      partner_code: true,
      partner_name: true,
      owner_name: true,
      company_name: true,
      email: true,
      mobile: true,
      alternate_mobile: true,
      city: true,
      state: true,
      gst_number: true,
      pan_number: true,
      bank_account: true,
      bank_ifsc: true,
      bank_name: true,
      upi_id: true,
      address: true,
      status: true,
      notes: true,
      available_capacity: true,
      network_locations: true,
      commission_percentage: true,
      commission_type: true,
      fixed_commission: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      partner_capability: true
    }
  });

  return partner;
}

/**
 * Middleware to attach partner to req.partner
 * Must be used after protect middleware
 */
const attachPartner = async (req, res, next) => {
  try {
    const partner = await getAuthenticatedPartner(req);
    
    if (!partner) {
      return res.status(403).json({
        success: false,
        message: 'Partner access denied. No associated partner account found.'
      });
    }

    if (!partner.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Partner account is inactive.'
      });
    }

    req.partner = partner;
    next();
  } catch (error) {
    console.error('Partner auth error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during partner authentication'
    });
  }
};

module.exports = {
  getAuthenticatedPartner,
  attachPartner
};