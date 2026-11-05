import { chromium } from 'playwright';

async function deepTest() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
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

  // Login with retry on 429
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto('http://localhost:5174/admin/login');
      await page.waitForLoadState('networkidle');
      await page.fill('input[name="email"]', 'admin@bihartransport.com');
      await page.fill('input[name="password"]', 'admin123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/admin', { timeout: 30000 });
      await page.waitForLoadState('networkidle');
      console.log('Logged in:', page.url());
      break;
    } catch (e) {
      console.log(`Login attempt ${attempt} failed:`, e.message);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // ============================================================
  // TEST A: Direct Booking Entry -> Each Lifecycle Stage
  // ============================================================
  console.log('\n========== PATH A: Direct Booking /admin/bookings/BTB-2026-02638 ==========');
  
  const stagesToTest = [
    { name: 'Loading', expectedUrl: '/admin/trips/4853/loading', checkInWorkspace: 'Loading' },
    { name: 'Dispatch', expectedUrl: '/admin/trips/4853/dispatch', checkInWorkspace: 'Dispatch' },
    { name: 'Transit', expectedUrl: '/admin/trips/4853/transit', checkInWorkspace: 'Transit' },
    { name: 'Delivery', expectedUrl: '/admin/trips/4853/delivery', checkInWorkspace: 'Delivery' },
    { name: 'POD', expectedUrl: '/admin/trips/4853/pod', checkInWorkspace: 'POD' },
    { name: 'Completed', expectedUrl: '/admin/trips/4853/completed', checkInWorkspace: 'Completed' },
  ];

  for (const stage of stagesToTest) {
    console.log(`\n--- Testing ${stage.name} from direct booking ---`);
    networkLogs.length = 0;
    
    await page.goto('http://localhost:5174/admin/bookings/BTB-2026-02638');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const btn = page.locator(`button:has-text("${stage.name}")`).first();
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(5000);
      
      const actualUrl = page.url();
      console.log(`  Navigated to: ${actualUrl}`);
      
      // Check if workspace loaded content
      const body = await page.textContent('body');
      const hasWorkspaceContent = body.includes(stage.checkInWorkspace) || body.includes('Loading') || body.includes('Dispatch');
      console.log(`  Workspace content detected: ${hasWorkspaceContent}`);
      
      // Check for API errors
      const apiErrors = networkLogs.filter(l => l.type === 'response' && l.status >= 400);
      if (apiErrors.length > 0) {
        console.log(`  API Errors:`);
        for (const err of apiErrors) {
          console.log(`    ${err.method || 'GET'} ${err.url} -> ${err.status}`);
        }
      }
      
      // Capture key API responses
      const workflowResp = networkLogs.find(l => l.url.includes('/workflow') && l.type === 'response');
      if (workflowResp) console.log(`  Workflow API: ${workflowResp.status}`);
    } else {
      console.log(`  ${stage.name} button NOT found`);
    }
  }

  // ============================================================
  // TEST B: Vehicle Hire -> View Trip -> Central Workspace Tabs
  // ============================================================
  console.log('\n========== PATH B: Vehicle Hire -> View Trip -> Central Workspace ==========');
  
  await page.goto('http://localhost:5174/admin/vehicle-hire');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const viewTripBtn = page.locator('text=View Trip').first();
  if (await viewTripBtn.count() > 0) {
    await viewTripBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    console.log(`  Landed on: ${page.url()}`);
    
    // Test tabs in central workspace
    const tabs = ['Loading', 'Dispatch', 'Transit', 'Delivery', 'POD', 'History'];
    for (const tabName of tabs) {
      console.log(`\n  --- Testing ${tabName} tab ---`);
      networkLogs.length = 0;
      
      const tabBtn = page.locator(`nav button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`).first();
      if (await tabBtn.count() > 0) {
        await tabBtn.click();
        await page.waitForTimeout(5000);
        
        const actualUrl = page.url();
        console.log(`    URL: ${actualUrl}`);
        
        const body = await page.textContent('body');
        const hasContent = body.length > 1000;
        console.log(`    Content loaded: ${hasContent}`);
        
        const apiErrors = networkLogs.filter(l => l.type === 'response' && l.status >= 400);
        if (apiErrors.length > 0) {
          console.log(`    API Errors:`);
          for (const err of apiErrors) {
            console.log(`      ${err.url} -> ${err.status}`);
          }
        }
      } else {
        console.log(`    Tab ${tabName} not found`);
      }
    }
  }

  // ============================================================
  // TEST C: Compare Workflow API State
  // ============================================================
  console.log('\n========== WORKFLOW API COMPARISON ==========');
  
  // Fetch workflow directly via API
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const workflowResp = await page.request.get('http://localhost:3000/api/trips/4853/workflow', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const workflowData = await workflowResp.json();
  console.log('Workflow API response:');
  console.log(JSON.stringify(workflowData.data?.stage, null, 2));

  // Fetch trip data
  const tripResp = await page.request.get('http://localhost:3000/api/trips/4853', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const tripData = await tripResp.json();
  console.log('\nTrip API response:');
  console.log('  trip_id:', tripData.data?.trip_id);
  console.log('  status:', tripData.data?.status);
  console.log('  vehicle_id:', tripData.data?.vehicle_id);
  console.log('  driver_id:', tripData.data?.driver_id);
  console.log('  booking_id:', tripData.data?.booking_id);

  // Fetch booking data
  const bookingResp = await page.request.get('http://localhost:3000/api/admin/bookings/by-number/BTB-2026-02638', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const bookingData = await bookingResp.json();
  console.log('\nBooking API response:');
  console.log('  booking_id:', bookingData.data?.booking_id);
  console.log('  status:', bookingData.data?.status);
  console.log('  trip:', bookingData.data?.trip);

  // ============================================================
  // TEST D: Booking BTB-2026-02653 (no trip)
  // ============================================================
  console.log('\n========== BOOKING BTB-2026-02653 (no trip) ==========');
  networkLogs.length = 0;
  await page.goto('http://localhost:5174/admin/bookings/BTB-2026-02653');
  await page.waitForLoadState('networkidle');
  console.log(`  URL: ${page.url()}`);
  
  const body = await page.textContent('body');
  const hasLifecycle = body.includes('Current Stage') || body.includes('Loading');
  console.log(`  Lifecycle visible: ${hasLifecycle}`);
  
  const tripInfo = body.match(/Trip:.*/);
  console.log(`  Trip info: ${tripInfo ? tripInfo[0] : 'NOT FOUND'}`);

  await browser.close();
}

deepTest().catch(console.error);