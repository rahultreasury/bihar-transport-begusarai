import { test } from 'playwright/test';

test('reproduce owners', async ({ page }) => {
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(`${err.name}: ${err.message}\n${err.stack}`));
  page.on('requestfailed', req => failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));

  await page.goto('http://127.0.0.1:5173/admin/login');
  await page.getByLabel('Admin Email').fill('admin@bihartransport.com');
  await page.getByLabel('Password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin');
  await page.goto('http://127.0.0.1:5173/admin/owners');
  await page.waitForTimeout(3000);
  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    body: (await page.locator('body').innerText()).slice(0, 3000),
    consoleMessages,
    pageErrors,
    failedRequests,
  }, null, 2));
});
