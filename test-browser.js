const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

async function testFinancials() {
  // Generate token
  const JWT_SECRET = 'btb_secret_key_2024_change_in_production';
  const token = jwt.sign({ id: 1, type: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  console.log('Token generated');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Set token in localStorage before navigating
  await page.goto('http://localhost:5173/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  console.log('Token set in localStorage');

  // Navigate to client-receivables
  await page.goto('http://localhost:5173/admin/financials/client-receivables');
  console.log('Navigated to client-receivables');

  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Check if table has rows
  const rows = await page.locator('tbody tr').count();
  console.log('Table rows found:', rows);

  // Check for Pioneer Industries row
  const pioneerRow = page.locator('tbody tr:has-text("Pioneer Industries")');
  const pioneerCount = await pioneerRow.count();
  console.log('Pioneer Industries rows:', pioneerCount);

  if (pioneerCount > 0) {
    console.log('Clicking Pioneer Industries...');
    await pioneerRow.first().click();
    await page.waitForTimeout(2000);

    // Check if modal opened
    const modal = page.locator('[role="dialog"]');
    const modalVisible = await modal.isVisible();
    console.log('Modal visible:', modalVisible);

    if (modalVisible) {
      const modalTitle = await modal.locator('h3').textContent();
      console.log('Modal title:', modalTitle);

      // Check for ledger data
      const billed = await modal.locator('text=Billed').first().textContent();
      console.log('Billed text:', billed);

      // Check for trips
      const tripRows = await modal.locator('tbody tr').count();
      console.log('Modal trip rows:', tripRows);

      // Close modal
      await modal.locator('button:has-text("Close")').click();
      await page.waitForTimeout(500);
    } else {
      console.log('ERROR: Modal did not open!');
      const pageContent = await page.content();
      console.log('Page content length:', pageContent.length);
    }
  }

  // Test client-due
  await page.goto('http://localhost:5173/admin/financials/client-due');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const dueRows = await page.locator('tbody tr').count();
  console.log('Client Due table rows:', dueRows);

  const duePioneer = page.locator('tbody tr:has-text("Pioneer Industries")');
  const duePioneerCount = await duePioneer.count();
  console.log('Client Due Pioneer Industries rows:', duePioneerCount);

  if (duePioneerCount > 0) {
    await duePioneer.first().click();
    await page.waitForTimeout(2000);

    const modal = page.locator('[role="dialog"]');
    const modalVisible = await modal.isVisible();
    console.log('Client Due Modal visible:', modalVisible);

    if (modalVisible) {
      const billed = await modal.locator('text=Billed').first().textContent();
      console.log('Client Due Modal Billed text:', billed);
    }
  }

  await browser.close();
  console.log('Test completed');
}

testFinancials().catch(console.error);