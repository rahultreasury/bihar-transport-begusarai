import { chromium } from 'playwright';

async function testLifecycle() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext();
  const page = await context.newPage();

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
  await page.waitForURL('**/admin');
  await page.waitForLoadState('networkidle');
  console.log('Logged in, current URL:', page.url());

  // Test 1: Direct Booking Entry
  console.log('\n========== TEST 1: Direct Booking Entry ==========');
  await page.goto('http://localhost:5174/admin/bookings/BTB-2026-02638');
  await page.waitForLoadState('networkidle');
  console.log('Direct booking URL:', page.url());

  // Check page content
  const body1 = await page.textContent('body');
  console.log('Page preview:', body1.substring(0, 1000));

  // Check for OrderLifecycle component
  const lifecycle = page.locator('[class*="OrderLifecycle"], [class*="lifecycle"]').first();
  if (await lifecycle.count() > 0) {
    console.log('OrderLifecycle FOUND on direct booking page');
  } else {
    console.log('OrderLifecycle NOT found on direct booking page');
  }

  // Look for lifecycle stages
  const stageButtons = await page.locator('button[type="button"]').all();
  console.log('Total buttons:', stageButtons.length);
  
  for (const btn of stageButtons) {
    const text = await btn.textContent();
    if (text && (text.includes('Loading') || text.includes('Dispatch') || text.includes('Transit') || text.includes('Delivery') || text.includes('POD') || text.includes('Completed') || text.includes('Vehicle'))) {
      console.log(`Found stage button: "${text.trim()}"`);
      const classes = await btn.getAttribute('class');
      console.log(`  Classes: ${classes}`);
      const disabled = await btn.isDisabled();
      console.log(`  Disabled: ${disabled}`);
      const visible = await btn.isVisible();
      console.log(`  Visible: ${visible}`);
    }
  }

  // Look for any element with lifecycle-related text
  const allElements = await page.locator('*').all();
  for (const el of allElements) {
    const text = await el.textContent();
    if (text && text.trim().match(/^(Loading|Dispatch|Transit|Delivery|POD|Completed|Vehicle)$/)) {
      const tag = await el.evaluate(e => e.tagName);
      const classes = await el.getAttribute('class');
      console.log(`Lifecycle element: <${tag}> "${text.trim()}" class="${classes}"`);
    }
  }

  // Try to click a stage if found
  const loadingBtn = page.locator('button:has-text("Loading")').first();
  if (await loadingBtn.count() > 0) {
    console.log('\nClicking Loading stage...');
    await loadingBtn.click();
    await page.waitForTimeout(2000);
    console.log('After click, URL:', page.url());
  } else {
    console.log('\nNo Loading button found to click');
  }

  // Test 2: Vehicle Hire Entry
  console.log('\n========== TEST 2: Vehicle Hire Entry ==========');
  await page.goto('http://localhost:5174/admin/vehicle-hire');
  await page.waitForLoadState('networkidle');
  console.log('Vehicle Hire URL:', page.url());

  const body2 = await page.textContent('body');
  console.log('Vehicle hire page preview:', body2.substring(0, 1000));

  // Find trip BTBT-2026-00041
  const tripRow = page.locator('text=BTBT-2026-00041').first();
  if (await tripRow.count() > 0) {
    console.log('Found trip BTBT-2026-00041');
    // Find the View Trip button - could be in the same row
    const viewTripBtn = page.locator('text=View Trip').first();
    if (await viewTripBtn.count() > 0) {
      console.log('Clicking View Trip...');
      await viewTripBtn.click();
      await page.waitForLoadState('networkidle');
      console.log('After View Trip, URL:', page.url());

      const body3 = await page.textContent('body');
      console.log('Trip page preview:', body3.substring(0, 1000));

      // Now test lifecycle clicks from here
      const stages2 = await page.locator('button[type="button"]').all();
      console.log('Number of buttons on trip page:', stages2.length);
      for (const stage of stages2) {
        const text = await stage.textContent();
        if (text && (text.includes('Loading') || text.includes('Dispatch') || text.includes('Transit') || text.includes('Delivery') || text.includes('POD') || text.includes('Completed'))) {
          console.log(`Found stage: "${text}"`);
          await stage.click();
          await page.waitForTimeout(2000);
          console.log('After click, URL:', page.url());
          break;
        }
      }
    }
  } else {
    console.log('Trip BTBT-2026-00041 not found in vehicle hire list');
    // Search for any trip
    const allText = await page.textContent('body');
    const tripMatches = allText.match(/BTBT-\d+/g);
    console.log('Trip numbers found:', tripMatches);
  }

  await browser.close();
}

testLifecycle().catch(console.error);