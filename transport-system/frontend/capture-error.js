const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({ type: 'console', text: msg.text() });
    }
  });
  
  page.on('pageerror', err => {
    errors.push({ type: 'pageerror', message: err.message, stack: err.stack });
  });
  
  // First login
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  
  // Fill login form - need to find the correct selectors
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 5000 }).catch(() => {});
  
  const emailInput = await page.$('input[name="email"], input[type="email"]');
  const passwordInput = await page.$('input[name="password"], input[type="password"]');
  const submitButton = await page.$('button[type="submit"]');
  
  if (emailInput && passwordInput && submitButton) {
    await emailInput.fill('admin@test.com');
    await passwordInput.fill('password');
    await submitButton.click();
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  }
  
  // Now navigate to the vehicle hire page
  await page.goto('http://localhost:5173/admin/trips/3224/vehicle-hire', { waitUntil: 'networkidle', timeout: 15000 });
  
  // Wait a bit for any errors to surface
  await page.waitForTimeout(3000);
  
  console.log('=== CAPTURED ERRORS ===');
  if (errors.length === 0) {
    console.log('No errors captured');
  } else {
    errors.forEach((err, i) => {
      console.log(`Error ${i + 1} (${err.type}):`);
      console.log(err.message || err.text);
      if (err.stack) console.log(err.stack);
      console.log('---');
    });
  }
  
  // Also check the page content
  const content = await page.content();
  if (content.includes('Something went wrong')) {
    console.log('PAGE SHOWS ERROR BOUNDARY FALLBACK');
  }
  
  await browser.close();
})();
