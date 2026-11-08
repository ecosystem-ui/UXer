import { test, expect, type Page } from '@playwright/test';
import {
  BMAAS_URL,
  createPersona,
  createProject,
  projectIdFromUrl,
  seedComment,
  signupViaUI,
} from './helpers';

// The "Bare metal" workspace renders instances as a card grid or as a table.
// The kebab button of the first table row exists in list view only, so it
// stands in for any structural selector that is layout-specific.
const KEBAB =
  '#root > div > div:nth-of-type(2) > main > section > div > div > div > div:nth-of-type(4) > table > tbody > tr:nth-of-type(1) > td:nth-of-type(6) > button';
const WORKSPACE =
  'https://heyethankim.github.io/osac-bmaas/tenant-admin/northsummit/workspace?nav=services-baremetal';

async function listVersions(page: Page, projectId: string) {
  const res = await page.request.get(`/api/projects/${projectId}/versions`);
  if (!res.ok()) throw new Error(`list versions failed: ${res.status()}`);
  return res.json();
}

async function seedRowComment(page: Page, versionId: string, state: string, body: string) {
  await seedComment(page, versionId, {
    selector: KEBAB,
    text_excerpt: '',
    page_url: WORKSPACE,
    step: '',
    state,
    state_mode: 'declarative',
    x: 0.6757,
    y: 0.0568,
    body,
  });
}

async function openPersonaAndThread(page: Page, label: string, body: string) {
  await page.getByText(label, { exact: true }).click();
  await page.getByText('Comment mode', { exact: true }).waitFor();
  // The bridge has to be running inside the design page before the comment
  // click can ask it to navigate; otherwise the message is dropped.
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Red Hat OSAC Prototypes 0.3' }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByText(body, { exact: true }).click();
  await expect(page.getByText(/Thread #/)).toBeVisible();
}

// The pin must sit on the row's kebab button, not at the fallback position in
// the top-centre of the preview.
async function expectPinOnKebab(page: Page) {
  const frame = page.frameLocator('iframe');
  const button = frame.locator(KEBAB);
  await expect(button).toBeVisible({ timeout: 30_000 });
  // The design re-renders the layout asynchronously, so poll until the pin
  // moves onto the row action button (the pin is centred on its anchor).
  await expect
    .poll(
      async () => {
        const btn = await button.boundingBox();
        const pin = await frame.locator('.uxer-pin').first().boundingBox();
        if (!btn || !pin) return false;
        const cx = pin.x + pin.width / 2;
        const cy = pin.y + pin.height / 2;
        const tol = 2;
        return (
          cx >= btn.x - tol &&
          cx <= btn.x + btn.width + tol &&
          cy >= btn.y - tol &&
          cy <= btn.y + btn.height + tol
        );
      },
      { timeout: 15_000, message: 'pin should sit on the row action button' },
    )
    .toBe(true);
}

test.describe('view layout state', () => {
  test('a comment recorded before the layout key existed still finds its element', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'Gail', email: 'gail@example.com', password: 'password123' });
      await createProject(page, 'BMAAS legacy');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'ethan legacy', BMAAS_URL);
      const [version] = await listVersions(page, projectId);

      // Legacy state: no `view=` pair, so the layout the comment was captured
      // in isn't recorded. The element only exists in list view.
      await seedRowComment(page, version.id, 'nav=Bare metal', 'row action');

      await openPersonaAndThread(page, 'ethan legacy', 'row action');

      // The bridge falls back to the layout where the selector resolves.
      const frame = page.frameLocator('iframe');
      await expect(frame.locator('[aria-label="List view"]')).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 30_000 },
      );
      await expectPinOnKebab(page);
    } finally {
      await ctx.close();
    }
  });

  test('a comment that recorded the list layout replays it', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'Hana', email: 'hana@example.com', password: 'password123' });
      await createProject(page, 'BMAAS replay');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'ethan replay', BMAAS_URL);
      const [version] = await listVersions(page, projectId);

      await seedRowComment(page, version.id, 'nav=Bare metal|view=List view', 'row action');

      await openPersonaAndThread(page, 'ethan replay', 'row action');

      const frame = page.frameLocator('iframe');
      await expect(frame.locator('[aria-label="List view"]')).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 30_000 },
      );
      await expectPinOnKebab(page);
    } finally {
      await ctx.close();
    }
  });

  test('new comments record the active layout', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'Iris', email: 'iris@example.com', password: 'password123' });
      await createProject(page, 'BMAAS capture');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'ethan capture', BMAAS_URL);
      const [version] = await listVersions(page, projectId);

      // A seeded comment gets the preview onto the Bare metal workspace.
      await seedRowComment(page, version.id, 'nav=Bare metal', 'row action');
      await openPersonaAndThread(page, 'ethan capture', 'row action');
      await page.getByRole('button', { name: 'Back to all comments' }).click();

      // Switch to list view explicitly, then capture a comment on the row's
      // action button.
      const frame = page.frameLocator('iframe');
      const listView = frame.locator('[aria-label="List view"]');
      if ((await listView.getAttribute('aria-pressed')) !== 'true') await listView.click();
      await expect(listView).toHaveAttribute('aria-pressed', 'true');

      await page.getByText('Comment mode', { exact: true }).click();
      await frame.locator(KEBAB).click();
      await page.getByPlaceholder('Write a comment…').fill('fresh capture');
      await page.getByRole('button', { name: 'Comment', exact: true }).click();
      await expect(page.getByText('fresh capture', { exact: true })).toBeVisible();

      const comments = await (
        await page.request.get(`/api/versions/${version.id}/comments`)
      ).json();
      const fresh = comments.find((c: { body: string }) => c.body === 'fresh capture');
      expect(fresh.state).toBe('nav=Bare metal|view=List view');

      // Routing back to it keeps the recorded layout and lands on the pin.
      await page.getByText('fresh capture', { exact: true }).click();
      await expect(page.getByText(/Thread #/)).toBeVisible();
      await expectPinOnKebab(page);
    } finally {
      await ctx.close();
    }
  });
});
