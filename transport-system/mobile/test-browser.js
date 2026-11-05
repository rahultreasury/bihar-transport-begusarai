const { chromium } = require('playwright');

async function testApp() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleLogs = [];
  const errors = [];
  
  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
    console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
    console.log(`[BROWSER ERROR] ${error.message}`);
  });
  
  page.on('requestfailed', request => {
    console.log(`[REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText}`);
  });

  console.log('Navigating to http://localhost:8081...');
  try {
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle', timeout: 60000 });
    console.log('Page loaded successfully');
  } catch (e) {
    console.log(`Navigation error: ${e.message}`);
  }

  // Wait a bit for React to render
  await page.waitForTimeout(5000);

  // Check page content
  const content = await page.content();
  console.log('\n=== PAGE HTML (first 3000 chars) ===');
  console.log(content.substring(0, 3000));
  
  // Check for specific elements
  const rootDiv = await page.$('#root');
  if (rootDiv) {
    const rootHtml = await rootDiv.evaluate(el => el.innerHTML);
    console.log('\n=== #root innerHTML ===');
    console.log(rootHtml.substring(0, 2000));
  } else {
    console.log('\n#root element not found!');
  }

  // Check for loading indicator
  const loadingDots = await page.$$('.expo-loading-dots, [data-testid="loading"], .loading');
  console.log(`\nLoading indicators found: ${loadingDots.length}`);

  await browser.close();
  
  console.log('\n=== SUMMARY ===');
  console.log(`Console logs: ${consoleLogs.length}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length > 0) {
    errors.forEach(e => console.log(`  - ${e}`));
  }
}

testApp().catch(console.error);