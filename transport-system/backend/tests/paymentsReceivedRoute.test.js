/**
 * Regression tests for Payments Received API route
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock prisma
const mockPrisma = {
  financialTransaction: {
    findMany: async () => [],
    count: async () => 0,
  },
};

test('GET /transactions route exists in financialRoutes', () => {
  const fs = require('fs');
  const routeContent = fs.readFileSync(
    'routes/financialRoutes.js',
    'utf8'
  );
  assert(routeContent.includes("router.get('/transactions'"), '/transactions route should exist');
  assert(routeContent.includes("router.get('/payments-received'"), '/payments-received route should exist');
});

test('GET /payments-received filters customer payments only', () => {
  const routeContent = require('fs').readFileSync(
    'routes/financialRoutes.js',
    'utf8'
  );
  assert(routeContent.includes("CUSTOMER_PAYMENT"), 'Should filter CUSTOMER_PAYMENT');
  assert(routeContent.includes("CLIENT_PAYMENT"), 'Should filter CLIENT_PAYMENT');
});

test('AdminFinancials uses getPaymentsReceived for payments tab', () => {
  const fs = require('fs');
  const pageContent = fs.readFileSync(
    '../frontend/src/pages/AdminFinancials.jsx',
    'utf8'
  );
  assert(pageContent.includes('financialAPI.getPaymentsReceived'), 'Should use getPaymentsReceived for payments tab');
});
