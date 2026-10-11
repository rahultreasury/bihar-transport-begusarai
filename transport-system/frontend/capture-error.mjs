import { chromium } from 'playwright';

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
  
  // Set the admin JWT token in localStorage
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidHlwZSI6ImFkbWluIiwiaWF0IjoxNzkxNzAyNjM2LCJleHAiOjE3OTIzMDc0MzZ9._Zfu7FYRjsSwyYGNF_oPEAFeUpjoZA-x53rlnc91Gmc';
  await page.goto('http://localhost:5173/');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.evaluate((t) => localStorage.setItem('user', t), JSON.stringify({ userId: 1, role: 'super_admin', email: 'admin@test.com', full_name: 'System Administrator' }));
  
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
  } else {
    console.log('PAGE LOADED SUCCESSFULLY');
  }
  
  await browser.close();
})();
