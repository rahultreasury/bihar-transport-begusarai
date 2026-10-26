import { chromium } from 'playwright';

async function testLifecycle() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  // Navigate to login
  await page.goto('http://localhost:5174/admin/login');
  await page.waitForLoadState('networkidle');

  // Login
  await page.fill('input[name="email"]', 'admin@bihartransport.com');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  // Wait for redirect to admin dashboard or any admin page
  await page.waitForURL('**/admin/**', { timeout: 10000 });
  console.log('Logged in, current URL:', page.url());

  // Test 1: Direct Booking Entry
  console.log('\n========== TEST 1: Direct Booking Entry ==========');
  await page.goto('http://localhost:5174/admin/bookings/BTB-2026-02638');
  await page.waitForLoadState('networkidle');
  console.log('Direct booking URL:', page.url());

  // Check if OrderLifecycle is rendered
  const lifecycle = page.locator('[class*="OrderLifecycle"], [class*="lifecycle"]').first();
  if (await lifecycle.count() > 0) {
    console.log('OrderLifecycle found on direct booking page');
  } else {
    console.log('OrderLifecycle NOT found on direct booking page');
    // Check page content
    const body = await page.textContent('body');
    console.log('Page body preview:', body.substring(0, 500));
  }

  // Check for trip ID in page
  const tripIdMatch = page.url().match(/\/admin\/bookings\/([^\/]+)/);
  console.log('Booking number from URL:', tripIdMatch?.[1]);

  // Check for Loading stage button
  const loadingStage = page.locator('button:has-text("Loading"), button:has-text("Dispatch"), button:has-text("Transit"), button:has-text("Delivery"), button:has-text("POD"), button:has-text("Completed"), [class*="stage"]').first();
  const stages = await page.locator('button[type="button"]').all();
  console.log('Number of buttons found:', stages.length);

  // Try to click Loading stage if exists
  for (const stage of stages) {
    const text = await stage.textContent();
    if (text && (text.includes('Loading') || text.includes('Dispatch') || text.includes('Transit') || text.includes('Delivery') || text.includes('POD') || text.includes('Completed'))) {
      console.log(`Found stage: "${text}"`);
      await stage.click();
      await page.waitForTimeout(1000);
      console.log('After click, URL:', page.url());
      break;
    }
  }

  // Test 2: Vehicle Hire Entry
  console.log('\n========== TEST 2: Vehicle Hire Entry ==========');
  await page.goto('http://localhost:5174/admin/vehicle-hire');
  await page.waitForLoadState('networkidle');
  console.log('Vehicle Hire URL:', page.url());

  // Find trip BTBT-2026-00041 and click View Trip
  const tripRow = page.locator('text=BTBT-2026-00041').first();
  if (await tripRow.count() > 0) {
    console.log('Found trip BTBT-2026-00041');
    // Find the View Trip button in the same row
    const viewTripBtn = page.locator('text=View Trip').first();
    if (await viewTripBtn.count() > 0) {
      console.log('Clicking View Trip...');
      await viewTripBtn.click();
      await page.waitForLoadState('networkidle');
      console.log('After View Trip, URL:', page.url());

      // Now test lifecycle clicks from here
      const stages2 = await page.locator('button[type="button"]').all();
      console.log('Number of buttons on trip page:', stages2.length);
      for (const stage of stages2) {
        const text = await stage.textContent();
        if (text && (text.includes('Loading') || text.includes('Dispatch') || text.includes('Transit') || text.includes('Delivery') || text.includes('POD') || text.includes('Completed'))) {
          console.log(`Found stage: "${text}"`);
          await stage.click();
          await page.waitForTimeout(1000);
          console.log('After click, URL:', page.url());
          break;
        }
      }
    }
  } else {
    console.log('Trip BTBT-2026-00041 not found in vehicle hire list');
    const body = await page.textContent('body');
    console.log('Vehicle hire page preview:', body.substring(0, 1000));
  }

  await browser.close();
}

testLifecycle().catch(console.error);