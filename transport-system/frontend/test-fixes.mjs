import { chromium } from 'playwright';

async function testFixes() {
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

  // Login with retry on 429
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto('http://localhost:5175/admin/login');
      await page.waitForLoadState('networkidle');
      await page.fill('input[name="email"]', 'admin@bihartransport.com');
      await page.fill('input[name="password"]', 'admin123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/admin', { timeout: 60000 });
      await page.waitForLoadState('networkidle');
      console.log('✅ Logged in');
      break;
    } catch (e) {
      console.log(`Login attempt ${attempt} failed:`, e.message);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // ============================================================
  // TEST 1: Booking WITH Trip (BTB-2026-02638 -> Trip 4853)
  // ============================================================
  console.log('\n========== TEST 1: Booking WITH Trip (BTB-2026-02638) ==========');
  
  await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Check for "No operational trip" message - should NOT be visible
  const noTripMessage = await page.locator('text="No operational trip created yet"').first();
  const noTripVisible = await noTripMessage.isVisible().catch(() => false);
  console.log(`  "No operational trip" message visible: ${noTripVisible ? 'FAIL (should be hidden)' : 'PASS (hidden)'}`);

  // Check Vehicle Hire header button - should be enabled
  const vehicleHireBtn = page.locator('button:has-text("Vehicle Hire")').first();
  if (await vehicleHireBtn.count() > 0) {
    const disabled = await vehicleHireBtn.isDisabled();
    console.log(`  Vehicle Hire header button disabled: ${disabled ? 'FAIL (should be enabled)' : 'PASS (enabled)'}`);
    
    // Click Vehicle Hire button
    await vehicleHireBtn.click();
    await page.waitForTimeout(3000);
    const url = page.url();
    const isTripSpecific = url.includes('/admin/trips/4853/vehicle-hire');
    console.log(`  Vehicle Hire button navigates to: ${url}`);
    console.log(`  Trip-specific hire page: ${isTripSpecific ? 'PASS' : 'FAIL'}`);
  }

  // Test lifecycle stages are clickable
  const stages = ['Loading', 'Dispatch', 'Transit', 'Delivery', 'POD', 'Completed'];
  for (const stage of stages) {
    await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    
    const btn = page.locator(`button:has-text("${stage}")`).first();
    if (await btn.count() > 0) {
      const disabled = await btn.isDisabled();
      console.log(`  ${stage} stage disabled: ${disabled ? 'FAIL' : 'PASS'}`);
    }
  }

  // ============================================================
  // TEST 2: Booking WITHOUT Trip (BTB-2026-02653)
  // ============================================================
  console.log('\n========== TEST 2: Booking WITHOUT Trip (BTB-2026-02653) ==========');
  
  await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02653');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Check for "No operational trip" message - should BE visible
  const noTripMessage2 = await page.locator('text="No operational trip created yet"').first();
  const noTripVisible2 = await noTripMessage2.isVisible().catch(() => false);
  console.log(`  "No operational trip" message visible: ${noTripVisible2 ? 'PASS' : 'FAIL'}`);
  
  // Check Vehicle Hire header button - should be disabled
  const vehicleHireBtn2 = page.locator('button:has-text("Vehicle Hire")').first();
  if (await vehicleHireBtn2.count() > 0) {
    const disabled = await vehicleHireBtn2.isDisabled();
    console.log(`  Vehicle Hire header button disabled: ${disabled ? 'PASS' : 'FAIL (should be disabled)'}`);
    
    // Try clicking - should not navigate
    await vehicleHireBtn2.click();
    await page.waitForTimeout(1000);
    const url = page.url();
    const stillOnBooking = url.includes('/admin/bookings/BTB-2026-02653');
    console.log(`  Vehicle Hire click stays on booking page: ${stillOnBooking ? 'PASS' : 'FAIL'}`);
  }

  // Test lifecycle stages are disabled
  for (const stage of stages) {
    await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02653');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    
    const btn = page.locator(`button:has-text("${stage}")`).first();
    if (await btn.count() > 0) {
      const disabled = await btn.isDisabled();
      console.log(`  ${stage} stage disabled: ${disabled ? 'PASS' : 'FAIL (should be disabled)'}`);
    }
  }

  // Check status cards are not clickable (no onClick)
  const statusCards = [
    'Vehicle Status',
    'Loading Status', 
    'Dispatch Status',
    'Delivery Status',
    'POD Status',
    'Payment Status'
  ];
  
  for (const cardTitle of statusCards) {
    const card = page.locator(`text="${cardTitle}"`).first();
    if (await card.count() > 0) {
      // Check if parent has onClick by trying to click
      const parent = card.locator('..').first();
      const isButton = await parent.evaluate(el => el.tagName === 'BUTTON').catch(() => false);
      console.log(`  ${cardTitle} card is button (clickable): ${isButton ? 'FAIL (should not be clickable)' : 'PASS (not clickable)'}`);
    }
  }

  // Check "No operational trip" message in lifecycle area
  const lifecycleNoTrip = await page.locator('text="No operational trip created yet"').first();
  console.log(`  Lifecycle area shows "No operational trip": ${await lifecycleNoTrip.isVisible().catch(() => false) ? 'PASS' : 'FAIL'}`);

  await browser.close();
  console.log('\n========== TEST COMPLETE ==========');
}

testFixes().catch(console.error);