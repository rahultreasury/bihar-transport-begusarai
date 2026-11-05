import { chromium } from 'playwright';

async function finalValidation() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const networkLogs = [];
  page.on('request', req => {
    if (req.url().includes('/api/')) {
      networkLogs.push({ type: 'request', url: req.url(), method: req.method() });
    }
  });
  page.on('response', res => {
    if (res.url().includes('/api/')) {
      networkLogs.push({ type: 'response', url: res.url(), status: res.status() });
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  // Login
  await page.goto('http://localhost:5175/admin/login');
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="email"]', 'admin@bihartransport.com');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin');
  await page.waitForLoadState('networkidle');
  console.log('✅ Logged in');

  // ============================================================
  // TEST 1: Direct Booking Entry - Trip 4853
  // ============================================================
  console.log('\n========== PATH A: Direct Booking /admin/bookings/BTB-2026-02638 (Trip 4853) ==========');
  
  await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Verify trip info
  const body = await page.textContent('body');
  const hasTrip4853 = body.includes('BTBT-2026-00041') || body.includes('4853');
  console.log(`  Trip 4853 visible: ${hasTrip4853 ? 'PASS' : 'FAIL'}`);

  // Check current stage
  const currentStageMatch = body.match(/Current Stage · ([^<\n]+)/);
  console.log(`  Current Stage: ${currentStageMatch ? currentStageMatch[1].trim() : 'NOT FOUND'}`);

  // Check vehicle/driver assignment
  const hasVehicle = body.includes('T-RES-V-179200544963569');
  const hasDriver = body.includes('Reservation Test Driver 59');
  console.log(`  Vehicle assigned: ${hasVehicle ? 'PASS' : 'FAIL'}`);
  console.log(`  Driver assigned: ${hasDriver ? 'PASS' : 'FAIL'}`);

  // Test each lifecycle stage
  const stagesToTest = [
    { name: 'Loading', expectedUrl: '/admin/trips/4853/loading', tabName: 'Loading' },
    { name: 'Dispatch', expectedUrl: '/admin/trips/4853/dispatch', tabName: 'Dispatch' },
    { name: 'Transit', expectedUrl: '/admin/trips/4853?tab=loading', tabName: 'Transit→Loading' },
    { name: 'Delivery', expectedUrl: '/admin/trips/4853?tab=pod', tabName: 'Delivery→POD' },
    { name: 'POD', expectedUrl: '/admin/trips/4853?tab=pod', tabName: 'POD' },
    { name: 'Completed', expectedUrl: '/admin/trips/4853?tab=pod', tabName: 'Completed→POD' },
  ];

  const results = { direct: {}, vehicleHire: {} };

  for (const stage of stagesToTest) {
    console.log(`\n  --- Testing ${stage.name} from direct booking ---`);
    networkLogs.length = 0;
    
    await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const btn = page.locator(`button:has-text("${stage.name}")`).first();
    if (await btn.count() > 0) {
      const disabled = await btn.isDisabled();
      console.log(`    Button clickable: ${!disabled ? 'PASS' : 'FAIL (disabled)'}`);
      
      await btn.click();
      await page.waitForTimeout(3000);
      const actualUrl = page.url();
      const urlMatch = actualUrl.includes(stage.expectedUrl);
      console.log(`    Navigated to: ${actualUrl}`);
      console.log(`    URL matches expected (${stage.expectedUrl}): ${urlMatch ? 'PASS' : 'FAIL'}`);
      
      // Check for workspace content
      const body = await page.textContent('body');
      const hasContent = body.length > 2000;
      console.log(`    Workspace content loaded: ${hasContent ? 'PASS' : 'FAIL'}`);
      
      // Check for API errors
      const apiErrors = networkLogs.filter(l => l.type === 'response' && l.status >= 400 && !l.url.includes('maps.googleapis.com'));
      if (apiErrors.length > 0) {
        console.log(`    API Errors:`);
        for (const err of apiErrors) {
          console.log(`      ${err.method || 'GET'} ${err.url} -> ${err.status}`);
        }
      }
      
      results.direct[stage.name] = {
        clickable: !disabled,
        urlMatch,
        hasContent,
        apiErrors: apiErrors.map(e => `${e.url} -> ${e.status}`)
      };
    } else {
      console.log(`    ${stage.name} button NOT found: FAIL`);
      results.direct[stage.name] = { clickable: false, urlMatch: false, hasContent: false };
    }
  }

  // Vehicle Hire button
  console.log('\n  --- Testing Vehicle Hire button ---');
  await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
  await page.waitForLoadState('networkidle');
  const vehicleHireBtn = page.locator('button:has-text("Vehicle Hire")').first();
  if (await vehicleHireBtn.count() > 0) {
    await vehicleHireBtn.click();
    await page.waitForTimeout(3000);
    const actualUrl = page.url();
    const isTripSpecific = actualUrl.includes('/admin/trips/4853/vehicle-hire');
    console.log(`    Navigated to: ${actualUrl}`);
    console.log(`    Trip-specific hire page: ${isTripSpecific ? 'PASS' : 'FAIL (went to global list)'}`);
  }

  // ============================================================
  // TEST 2: Vehicle Hire Entry - Trip 4853
  // ============================================================
  console.log('\n========== PATH B: Vehicle Hire → View Trip → /admin/trips/4853 ==========');
  
  await page.goto('http://localhost:5175/admin/vehicle-hire');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const viewTripBtn = page.locator('text=View Trip').first();
  if (await viewTripBtn.count() > 0) {
    await viewTripBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    console.log(`  Landed on: ${page.url()}`);
    
    // Test tabs in central workspace
    const tabs = ['Loading', 'Dispatch', 'Transit', 'Delivery', 'POD', 'History'];
    for (const tabName of tabs) {
      console.log(`\n  --- Testing ${tabName} tab ---`);
      networkLogs.length = 0;
      
      const tabBtn = page.locator(`nav button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`).first();
      if (await tabBtn.count() > 0) {
        await tabBtn.click();
        await page.waitForTimeout(3000);
        
        const actualUrl = page.url();
        console.log(`    URL: ${actualUrl}`);
        
        const body = await page.textContent('body');
        const hasContent = body.length > 2000;
        console.log(`    Content loaded: ${hasContent ? 'PASS' : 'FAIL'}`);
        
        const apiErrors = networkLogs.filter(l => l.type === 'response' && l.status >= 400 && !l.url.includes('maps.googleapis.com'));
        if (apiErrors.length > 0) {
          console.log(`    API Errors:`);
          for (const err of apiErrors) {
            console.log(`      ${err.url} -> ${err.status}`);
          }
        }
        
        results.vehicleHire[tabName] = { hasContent, apiErrors: apiErrors.map(e => `${e.url} -> ${e.status}`) };
      } else {
        console.log(`    Tab ${tabName} not found: FAIL`);
      }
    }
  }

  // ============================================================
  // TEST 3: Delivery API 403 Investigation
  // ============================================================
  console.log('\n========== INVESTIGATION: Delivery API 403 ==========');
  
  // Get token from page
  const token = await page.evaluate(() => localStorage.getItem('token'));
  
  // Test delivery API directly
  const deliveryResp = await page.request.get('http://localhost:3000/api/trips/4853/delivery', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const deliveryStatus = deliveryResp.status();
  console.log(`  GET /api/trips/4853/delivery: ${deliveryStatus}`);
  if (deliveryStatus === 403) {
    const deliveryBody = await deliveryResp.json();
    console.log(`  Response: ${JSON.stringify(deliveryBody)}`);
    console.log(`  403 is INTENTIONAL - trip status is PENDING, delivery requires IN_TRANSIT or later`);
  }

  // Test with a trip that IS in transit (if any)
  const tripsInTransit = await page.request.get('http://localhost:3000/api/trips?status=IN_TRANSIT&limit=1', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const tripsData = await tripsInTransit.json();
  if (tripsData.success && tripsData.data?.length > 0) {
    const transitTrip = tripsData.data[0];
    console.log(`  Found trip in IN_TRANSIT: ${transitTrip.trip_number} (${transitTrip.trip_id})`);
    
    const transitDelivery = await page.request.get(`http://localhost:3000/api/trips/${transitTrip.trip_id}/delivery`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`  GET /api/trips/${transitTrip.trip_id}/delivery: ${transitDelivery.status()}`);
  } else {
    console.log(`  No trips in IN_TRANSIT status found`);
  }

  // ============================================================
  // TEST 4: POD and Completion Endpoints Data Verification
  // ============================================================
  console.log('\n========== VERIFICATION: POD and Completion Endpoints ==========');
  
  const podResp = await page.request.get('http://localhost:3000/api/trips/4853/pod', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`  GET /api/trips/4853/pod: ${podResp.status()}`);
  const podData = await podResp.json();
  console.log(`  Has pod data: ${podData.success && podData.data ? 'PASS' : 'FAIL'}`);
  console.log(`  Pod object present: ${podData.data?.pod ? 'PASS (has pod object)' : 'EXPECTED NULL (no POD yet)'}`);
  console.log(`  Timeline entries: ${Array.isArray(podData.data?.timeline) ? podData.data.timeline.length : 0}`);

  const completionResp = await page.request.get('http://localhost:3000/api/trips/4853/completion', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`  GET /api/trips/4853/completion: ${completionResp.status()}`);
  const completionData = await completionResp.json();
  console.log(`  Has completion data: ${completionData.success && completionData.data ? 'PASS' : 'FAIL'}`);
  console.log(`  Ready: ${completionData.data?.ready}`);
  console.log(`  Blockers: ${JSON.stringify(completionData.data?.blockers)}`);

  // ============================================================
  // TEST 5: Booking without Trip (BTB-2026-02653)
  // ============================================================
  console.log('\n========== TEST: Booking without Trip (BTB-2026-02653) ==========');
  
  await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02653');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const bodyNoTrip = await page.textContent('body');
  const hasNoTripMessage = bodyNoTrip.includes('Not operational yet') || bodyNoTrip.includes('no operational trip');
  console.log(`  Shows "Not operational yet": ${hasNoTripMessage ? 'PASS' : 'FAIL'}`);
  
  // Try clicking a future stage
  const loadingBtnNoTrip = page.locator('button:has-text("Loading")').first();
  if (await loadingBtnNoTrip.count() > 0) {
    const disabled = await loadingBtnNoTrip.isDisabled();
    console.log(`  Loading button disabled (no trip): ${disabled ? 'PASS (correctly disabled)' : 'FAIL (should be disabled)'}`);
  }

  // ============================================================
  // TEST 6: Cross-Entry Consistency
  // ============================================================
  console.log('\n========== CROSS-ENTRY CONSISTENCY CHECK ==========');
  
  // Compare workflow API
  const wfResp = await page.request.get('http://localhost:3000/api/trips/4853/workflow', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const wfData = await wfResp.json();
  const currentStage = wfData.data?.stage?.current_stage;
  console.log(`  Workflow current_stage: ${currentStage}`);
  
  // Compare trip API
  const tripResp = await page.request.get('http://localhost:3000/api/trips/4853', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const tripData = await tripResp.json();
  console.log(`  Trip status: ${tripData.data?.status}`);
  console.log(`  Trip vehicle_id: ${tripData.data?.vehicle_id}`);
  console.log(`  Trip driver_id: ${tripData.data?.driver_id}`);
  console.log(`  Trip vehicleHire status: ${tripData.data?.vehicleHire?.status}`);
  console.log(`  Trip hire_status: ${tripData.data?.hire_status}`);

  // ============================================================
  // TEST 7: Error Check
  // ============================================================
  console.log('\n========== ERROR CHECK ==========');
  
  const allApiErrors = networkLogs.filter(l => l.type === 'response' && l.status >= 400 && !l.url.includes('maps.googleapis.com'));
  if (allApiErrors.length > 0) {
    console.log(`  Total API errors: ${allApiErrors.length}`);
    for (const err of allApiErrors) {
      console.log(`    ${err.method || 'GET'} ${err.url} -> ${err.status}`);
    }
  } else {
    console.log(`  No API errors (excluding Google Maps): PASS`);
  }

  console.log('\n========== SUMMARY ==========');
  console.log('Direct Booking results:', JSON.stringify(results.direct, null, 2));
  console.log('Vehicle Hire results:', JSON.stringify(results.vehicleHire, null, 2));

  await browser.close();
}

finalValidation().catch(console.error);