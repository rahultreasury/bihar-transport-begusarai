/**
 * Diagnostic: replicate the Transport Owner Details page backend calls for
 * partner id 6 (GET /api/admin/partners/6 and /6/dashboard) and report the
 * exact error. No credentials are printed.
 */
require('dotenv').config();
const PartnerService = require('../services/PartnerService');

async function main() {
  const svc = new PartnerService();
  const id = 6;

  console.log('--- getPartnerProfile(6) ---');
  try {
    const p = await svc.getPartnerProfile(id);
    console.log('profile result:', p ? `found partner_id=${p.partner_id}` : 'null (not found)');
  } catch (e) {
    console.error('profile ERROR:', e.message, '| code:', e.code, '| meta:', JSON.stringify(e.meta || null));
  }

  console.log('--- getPartnerDashboard(6) ---');
  try {
    const d = await svc.getPartnerDashboard(id);
    console.log('dashboard result:', d ? 'returned object' : 'null');
  } catch (e) {
    console.error('dashboard ERROR:', e.message, '| code:', e.code, '| meta:', JSON.stringify(e.meta || null));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
