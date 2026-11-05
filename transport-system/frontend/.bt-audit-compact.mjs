import { chromium } from 'playwright';
import fs from 'node:fs';

const token = fs.existsSync('/private/var/folders/88/x_p__cnj04s62qxj3bdfj3tw0000gn/T/opencode/bt-token.txt')
  ? fs.readFileSync('/private/var/folders/88/x_p__cnj04s62qxj3bdfj3tw0000gn/T/opencode/bt-token.txt', 'utf8').trim()
  : '';
const user = JSON.stringify({
  user_id: 1,
  admin_id: 1,
  id: 1,
  email: 'admin@bihartransport.com',
  full_name: 'System Administrator',
  name: 'System Administrator',
  role: 'super_admin',
});

const browser = await chromium.launch({ headless: true });
for (const [w, h, name] of [
  [1586, 992, '1586'],
  [1440, 900, '1440'],
  [1280, 900, '1280'],
  [1024, 900, '1024'],
  [390, 844, '390'],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('token', t);
      localStorage.setItem('user', u);
    },
    [token, user]
  );
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5174/admin/bookings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const data = await page.evaluate(() => {
    const rectFor = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
        left: +r.left.toFixed(1),
        right: +r.right.toFixed(1),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
      };
    };
    const rect = (sel) => rectFor(document.querySelector(sel));
    const hero = document.querySelector('section[aria-labelledby="order-trip-master-title"]');
    const kpiGrid = hero?.nextElementSibling?.querySelector('.grid');
    const cards = kpiGrid ? [...kpiGrid.children] : [];
    const filterInput = document.querySelector('input[aria-label="Search orders"]');
    const filterPanel = filterInput?.parentElement?.parentElement;
    const tabPanel = filterPanel?.nextElementSibling;
    const tableWrap = tabPanel?.nextElementSibling;
    const table = document.querySelector('table');
    const art = hero?.querySelector('img[width="2332"]')?.parentElement;
    const heroButtons = hero ? [...hero.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...rectFor(b) })) : [];
    const headerButtons = [...document.querySelectorAll('header button, header a')].map((b) => ({
      tag: b.tagName,
      text: b.textContent.trim().slice(0, 24),
      label: b.getAttribute('aria-label') || '',
      ...rectFor(b),
    }));
    return {
      header: rect('header'),
      hero: rectFor(hero),
      h1: rect('h1'),
      breadcrumb: rect('nav[aria-label="Breadcrumb"]'),
      chips: hero ? [...hero.querySelectorAll('span.inline-flex.rounded-full')].map(rectFor) : [],
      heroButtons,
      heroArt: rectFor(art),
      headerButtons,
      cards: cards.map((c) => ({
        ...rectFor(c),
        text: c.innerText.replace(/\n/g, ' | ').slice(0, 90),
      })),
      kpiGrid: rectFor(kpiGrid),
      filter: rectFor(filterPanel),
      search: rectFor(filterInput),
      selects: [...document.querySelectorAll('select')].map(rectFor),
      tabs: rectFor(tabPanel),
      tabButtons: tabPanel ? [...tabPanel.querySelectorAll('button')].map((b) => ({ text: b.innerText.replace(/\n/g, ' '), ...rectFor(b) })) : [],
      tableWrap: rectFor(tableWrap),
      table: rectFor(table),
      tableHead: table?.querySelector('thead') ? rectFor(table.querySelector('thead')) : null,
      rows: [...document.querySelectorAll('tbody tr')].slice(0, 6).map(rectFor),
      rowCount: document.querySelectorAll('tbody tr').length,
      pagination: rectFor(document.querySelector('tbody tr')?.closest('table')?.parentElement?.parentElement?.lastElementChild),
      bodyH: document.body.scrollHeight,
      innerH: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      pageW: innerWidth,
      filtersText: document.body.innerText.match(/All\s+2245[\s\S]{0,190}/)?.[0] || null,
      kpiValues: cards.map((c) => c.innerText.replace(/\n/g, ' | ')),
      headerText: document.querySelector('header')?.innerText.replace(/\n/g, ' | '),
    };
  });

  console.log('\n###', name, JSON.stringify(data, null, 2), '\nerrors', JSON.stringify(errors, null, 2));
  await page.screenshot({ path: `/private/var/folders/88/x_p__cnj04s62qxj3bdfj3tw0000gn/T/opencode/bt-compact/after-${name}.png` });
  await ctx.close();
}
await browser.close();
