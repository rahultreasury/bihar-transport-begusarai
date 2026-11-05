import { chromium } from 'playwright';
import fs from 'node:fs';

const token = fs.readFileSync('/private/var/folders/88/x_p__cnj04s62qxj3bdfj3tw0000gn/T/opencode/bt-token.txt', 'utf8').trim();
const user = JSON.stringify({
  user_id: 1,
  admin_id: 1,
  id: 1,
  email: 'admin@bihartransport.com',
  full_name: 'System Administrator',
  name: 'System Administrator',
  role: 'super_admin',
});

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const requests = [];
page.on('request', (r) => {
  if (r.url().includes('/api/admin/bookings') || r.url().includes('/api/admin/lifecycle')) requests.push(r.url());
});
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
await page.addInitScript(([t, u]) => {
  localStorage.setItem('token', t);
  localStorage.setItem('user', u);
}, [token, user]);
await page.goto('http://localhost:5174/admin/bookings', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

check('header height 72', (await page.locator('header').evaluate((el) => el.getBoundingClientRect().height)) === 72);
check('hero height 206', (await page.locator('section[aria-labelledby="order-trip-master-title"]').evaluate((el) => el.getBoundingClientRect().height)) === 206);
check('eight KPI cards', (await page.locator('section[aria-labelledby="order-trip-master-title"] + div .grid').first().locator('> *').count()) === 8);
check('eleven lifecycle tabs', (await page.locator('main button[aria-pressed]').count()) === 11);
check('desktop table visible', await page.locator('table').isVisible());
check('first table row visible above fold', (await page.locator('tbody tr').first().boundingBox()).y + 44 <= 900);

// Search
const beforeSearch = requests.length;
await page.getByLabel('Search orders').fill('Reservation');
await page.waitForTimeout(1200);
check('search request carries search term', requests.slice(beforeSearch).some((u) => decodeURIComponent(u).includes('search=Reservation')), requests.slice(beforeSearch).join('\n'));
check('search results remain rendered', (await page.locator('tbody tr').count()) > 0);
await page.getByLabel('Search orders').fill('');
await page.waitForTimeout(900);

// Status filter
const beforeStatus = requests.length;
await page.getByLabel('Filter by backend status').selectOption('confirmed');
await page.waitForTimeout(900);
check('status filter request carries status', requests.slice(beforeStatus).some((u) => u.includes('status=confirmed')), requests.slice(beforeStatus).join('\n'));
await page.getByLabel('Filter by backend status').selectOption('');
await page.waitForTimeout(900);

// Date filter
const beforeDate = requests.length;
await page.getByLabel('Filter by date').selectOption('today');
await page.waitForTimeout(900);
check('date filter request carries range', requests.slice(beforeDate).some((u) => u.includes('date_from=') && u.includes('date_to=')), requests.slice(beforeDate).join('\n'));
await page.getByLabel('Filter by date').selectOption('');
await page.waitForTimeout(900);

// Lifecycle tab
const beforeStage = requests.length;
await page.getByRole('button', { name: /^Enquiry 528$/ }).click();
await page.waitForTimeout(900);
check('Enquiry tab requests stage', requests.slice(beforeStage).some((u) => u.includes('stage=ENQUIRY')), requests.slice(beforeStage).join('\n'));
check('Enquiry tab is pressed', await page.getByRole('button', { name: /^Enquiry 528$/ }).getAttribute('aria-pressed') === 'true');
await page.getByRole('button', { name: /^All 2245$/ }).click();
await page.waitForTimeout(900);

// Refresh
const beforeRefresh = requests.length;
await page.getByLabel('Refresh orders').click();
await page.waitForTimeout(900);
check('refresh issues fresh list request', requests.length > beforeRefresh, `${requests.length - beforeRefresh} requests`);

// More actions menu + View order
await page.getByLabel(/^More actions for /).first().click();
await page.waitForTimeout(150);
check('row action menu opens', await page.getByRole('menu').isVisible());
check('row action menu has view + assign', (await page.getByRole('menuitem').count()) === 2);
await page.getByRole('menuitem', { name: 'View order' }).click();
await page.waitForURL(/\/admin\/bookings\/[^/]+$/, { timeout: 8000 });
check('row action navigates to detail', /\/admin\/bookings\/[^/]+$/.test(new URL(page.url()).pathname));
await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// Row click
const firstOrderNo = (await page.locator('tbody tr').first().locator('button').first().innerText()).trim();
await page.locator('tbody tr').first().click({ position: { x: 700, y: 20 } });
await page.waitForURL(/\/admin\/bookings\/[^/]+$/, { timeout: 8000 });
check('table row navigates to detail', decodeURIComponent(page.url()).includes(firstOrderNo), `${page.url()} vs ${firstOrderNo}`);
await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// Pagination
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(300);
const nextButton = page.getByRole('button', { name: 'Next' });
check('pagination next exists', await nextButton.isVisible());
if (await nextButton.isVisible()) {
  const beforePage = requests.length;
  await nextButton.click();
  await page.waitForTimeout(900);
  check('next page requests page 2', requests.slice(beforePage).some((u) => u.includes('page=2')), requests.slice(beforePage).join('\n'));
  check('pagination summary shows page 2', (await page.locator('main').innerText()).includes('Page 2'));
  await page.getByRole('button', { name: 'Previous' }).click();
  await page.waitForTimeout(900);
}

// Drawer
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByLabel('Open navigation menu').click();
await page.waitForTimeout(250);
check('navigation drawer opens', await page.locator('#admin-navigation-drawer').isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('navigation drawer closes on Escape', !(await page.locator('#admin-navigation-drawer').isVisible()));

// Profile
await page.getByLabel('Open profile menu').click();
await page.waitForTimeout(150);
check('profile menu opens', await page.getByRole('menu', { name: 'Profile menu' }).isVisible());
await page.keyboard.press('Escape');

check('no console errors on bookings', consoleErrors.length === 0, consoleErrors.join('\n'));

// Shared header on other pages
for (const path of ['/admin/financials', '/admin/vehicle-hire', '/admin/enquiries', '/admin/drivers']) {
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(`http://localhost:5174${path}`, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(1600);
  const m = await p2.evaluate(() => ({
    header: document.querySelector('header')?.getBoundingClientRect().height,
    quick: [...document.querySelectorAll('header .bt-btn-header-vehicle-hire, header .bt-btn-header-bookings, header .bt-btn-header-financials')].map((b) => {
      const r = b.getBoundingClientRect();
      return `${b.textContent.trim()}:${r.width}x${r.height}`;
    }),
    logo: document.querySelector('header a[aria-label="Bihar Transport admin home"]')?.getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth - innerWidth,
    title: document.title,
  }));
  check(`${path} header is 72px`, m.header === 72, JSON.stringify(m));
  check(`${path} no horizontal overflow`, m.overflow <= 0, JSON.stringify(m));
  check(`${path} no runtime errors`, errs.length === 0, errs.join('\n'));
  await p2.screenshot({ path: `/private/var/folders/88/x_p__cnj04s62qxj3bdfj3tw0000gn/T/opencode/bt-compact/page-${path.split('/').pop()}.png` });
  await p2.close();
}

const failures = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
await browser.close();
process.exit(failures.length ? 1 : 0);
