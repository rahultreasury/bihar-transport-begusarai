import { chromium } from 'playwright';

async function testAllStages() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
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
  await page.goto('http://localhost:5175/admin/login');
  await page.waitForLoadState('networkidle');

  // Login
  await page.fill('input[name="email"]', 'admin@bihartransport.com');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin');
  await page.waitForLoadState('networkidle');
  console.log('Logged in, current URL:', page.url());

  // Test Direct Booking Entry -> Each Lifecycle Stage
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
    
    await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const btn = page.locator(`button:has-text("${stage.name}")`).first();
    if (await btn.count() > 0) {
      const classes = await btn.getAttribute('class');
      const disabled = await btn.isDisabled();
      console.log(`${stage.name} button found - Classes: ${classes}, Disabled: ${disabled}`);
      
      await btn.click();
      await page.waitForTimeout(3000);
      console.log(`After clicking ${stage.name}, URL: ${page.url()}`);
    } else {
      console.log(`${stage.name} button NOT found`);
    }
  }

  // Also test Vehicle Hire stage
  console.log('\n--- Testing Vehicle Hire stage ---');
  await page.goto('http://localhost:5175/admin/bookings/BTB-2026-02638');
  await page.waitForLoadState('networkidle');
  
  const vehicleHireBtn = page.locator('button:has-text("Vehicle Hire")').first();
  if (await vehicleHireBtn.count() > 0) {
    console.log('Vehicle Hire button found');
    await vehicleHireBtn.click();
    await page.waitForTimeout(3000);
    console.log('After clicking Vehicle Hire, URL:', page.url());
  }

  await browser.close();
}

testAllStages().catch(console.error);