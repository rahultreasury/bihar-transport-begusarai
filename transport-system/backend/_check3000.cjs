require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const http = require('http');
const prisma = new PrismaClient();
function get(path, token) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3000, path, headers: { Authorization: 'Bearer ' + token } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), disp: res.headers['content-disposition'] || '' }));
    }).on('error', reject);
  });
}
(async () => {
  try {
    const admin = await prisma.admin.findFirst({ where: { email: 'admin@bihartransport.com' }, select: { admin_id: true } });
    const token = jwt.sign({ type: 'admin', id: admin.admin_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const tx = await prisma.financialTransaction.findFirst({
      where: { transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] }, direction: 'CREDIT', trip_id: { not: null } },
      orderBy: { transaction_id: 'desc' },
      select: { transaction_id: true, trip_id: true },
    });
    const r = await get(`/api/trips/${tx.trip_id}/payments/${tx.transaction_id}/RECEIPT.pdf`, token);
    console.log('PORT3000_RECEIPT status=' + r.status + ' isPDF=' + (r.buf.subarray(0, 5).toString() === '%PDF-') + ' disp=' + r.disp);
  } catch (e) { console.error('ERR', e.message); } finally { await prisma.$disconnect(); }
})();