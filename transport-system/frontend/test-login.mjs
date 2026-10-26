import { chromium } from 'playwright';

async function testLogin() {
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
  console.log('Initial URL:', page.url());

  // Take screenshot of login page
  await page.screenshot({ path: '/tmp/login-page.png', fullPage: true });
  console.log('Screenshot saved to /tmp/login-page.png');

  // Check what forms exist
  const forms = await page.locator('form').all();
  console.log('Number of forms:', forms.length);
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const inputs = await form.locator('input').all();
    console.log(`Form ${i}: ${inputs.length} inputs`);
    for (const input of inputs) {
      const type = await input.getAttribute('type');
      const name = await input.getAttribute('name');
      const placeholder = await input.getAttribute('placeholder');
      console.log(`  Input: type=${type}, name=${name}, placeholder=${placeholder}`);
    }
    const buttons = await form.locator('button').all();
    console.log(`  Buttons: ${buttons.length}`);
    for (const btn of buttons) {
      const text = await btn.textContent();
      const type = await btn.getAttribute('type');
      console.log(`    Button: "${text}", type=${type}`);
    }
  }

  // Try to find admin login specifically
  const adminLoginBtn = page.locator('button:has-text("Admin Login"), a:has-text("Admin Login"), [role="tab"]:has-text("Admin")').first();
  if (await adminLoginBtn.count() > 0) {
    console.log('Found Admin Login tab/button, clicking...');
    await adminLoginBtn.click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/after-admin-tab.png', fullPage: true });
  }

  // Fill login form
  const emailInput = page.locator('input[name="email"], input[type="email"]').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  const submitBtn = page.locator('button[type="submit"]').first();

  console.log('Email input exists:', await emailInput.count() > 0);
  console.log('Password input exists:', await passwordInput.count() > 0);
  console.log('Submit button exists:', await submitBtn.count() > 0);

  await emailInput.fill('admin@bihartransport.com');
  await passwordInput.fill('admin123');
  await submitBtn.click();

  // Wait for navigation
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  console.log('After login attempt, URL:', page.url());
  
  await page.screenshot({ path: '/tmp/after-login.png', fullPage: true });

  // Check if we're still on login page
  const body = await page.textContent('body');
  console.log('Body preview:', body.substring(0, 500));

  // Try direct admin dashboard
  await page.goto('http://localhost:5174/admin');
  await page.waitForLoadState('networkidle');
  console.log('After /admin, URL:', page.url());
  await page.screenshot({ path: '/tmp/admin-dashboard.png', fullPage: true });
  
  const body2 = await page.textContent('body');
  console.log('Admin page preview:', body2.substring(0, 500));

  await browser.close();
}

testLogin().catch(console.error);