const { chromium } = require('playwright');
const fs = require('fs');
const auth = JSON.parse(fs.readFileSync('/tmp/bt_auth.json', 'utf8'));
const base = 'http://localhost:5173';
const OUT = '/Users/rahulraj/Downloads/bihar-transport-begusarai-main/transport-system/frontend';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }, auth);
  await page.goto(base + '/admin/drivers/register-resources', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  // Select only Transport Owner, Continue.
  await page.locator('button:has-text("Transport Owner")').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Continue")').first().click();
  await page.waitForTimeout(1200);

  const layout = await page.evaluate(() => {
    const de = document.documentElement;
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length;
    const bodyText = document.body.innerText;
    return {
      url: location.pathname,
      dialogs,
      hasToggle: bodyText.includes('Select Existing') || bodyText.includes('Create New'),
      hasOwnerNameField: !!document.querySelector('input[placeholder="e.g. Rahul Sharma"]'),
      hOverflow: de.scrollWidth - de.clientWidth,
      nestedScroll: Array.from(document.querySelectorAll('*')).filter((el) => { const cs = getComputedStyle(el); return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8 && el !== de && el !== document.body; }).length,
    };
  });
  await page.screenshot({ path: OUT + '/_rb_details.png' });

  // Fill the owner form with clearly-test data.
  const stamp = Date.now().toString().slice(-6);
  const testName = `ZZ Rollback Verify ${stamp}`;
  const testMobile = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  await page.locator('input[placeholder="e.g. Rahul Sharma"]').fill(testName);
  await page.locator('input[placeholder="XXXX-XXX-XXX"]').fill(testMobile);
  await page.locator('input[placeholder="Enter city"]').fill('Begusarai');
  await page.waitForTimeout(300);

  // Continue to Review, verify the entered data appears.
  await page.locator('button:has-text("Continue to Review")').first().click();
  await page.waitForTimeout(1200);
  const reviewText = await page.evaluate(() => document.body.innerText);
  const reviewOk = reviewText.includes(testName) && reviewText.includes('Begusarai');
  await page.screenshot({ path: OUT + '/_rb_review.png' });

  // Submit (creates ONE clearly-test owner) and verify success.
  await page.locator('button.bt-btn-accent:has-text("Register")').click();
  await page.waitForTimeout(2600);
  const successText = await page.evaluate(() => document.body.innerText);
  const submit = { successShown: /registered/i.test(successText), nameShown: successText.includes(testName) };
  await page.screenshot({ path: OUT + '/_rb_success.png' });

  console.log('LAYOUT:' + JSON.stringify(layout));
  console.log('REVIEW_OK:' + reviewOk);
  console.log('SUBMIT:' + JSON.stringify(submit));
  console.log('CONSOLE_ERRORS:' + JSON.stringify(errs.slice(0, 6)));
  await browser.close();
})().catch((e) => { console.error('SCRIPT_ERR:' + e.message); process.exit(1); });
