import { test, expect, type Page } from '@playwright/test';
import {
  VMAS_URL,
  createPersona,
  createProject,
  projectIdFromUrl,
  seedComment,
  signupViaUI,
} from './helpers';

async function listVersions(page: Page, projectId: string) {
  const res = await page.request.get(`/api/projects/${projectId}/versions`);
  if (!res.ok()) throw new Error(`list versions failed: ${res.status()}`);
  return res.json();
}

test.describe('subview routing (generic view replay)', () => {
  test('clicking a VM-detail comment opens the VM detail view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'VmOpen', email: 'vm-open@example.com', password: 'password123' });
      await createProject(page, 'VM open');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'VM open persona', VMAS_URL);

      const versions = await listVersions(page, projectId);
      await seedComment(page, versions[0].id, {
        selector: '.ethan-detail-header__title',
        text_excerpt: 'VM detail comment',
        page_url: VMAS_URL,
        step: '',
        state: 'nav=Virtual machines|vm=azure-baboon-27',
        state_mode: 'declarative',
        x: 0.5,
        y: 0.5,
        body: 'VM detail comment',
      });

      await page.getByText('VM open persona', { exact: true }).click();
      await page.getByText('Comment mode', { exact: true }).waitFor();

      const frame = page.frameLocator('iframe');
      await expect(frame.locator('[data-open-vm]').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('VM detail comment', { exact: true })).toBeVisible();

      // Clicking the comment must route to (open) the recorded VM detail.
      await page.getByText('VM detail comment', { exact: true }).click();
      await expect(
        frame.locator('#view-vm.pf-m-active .ethan-detail-header__title'),
      ).toHaveText('azure-baboon-27', { timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test('clicking a list comment while in VM detail returns to the list', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'VmClose', email: 'vm-close@example.com', password: 'password123' });
      await createProject(page, 'VM close');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'VM close persona', VMAS_URL);

      const versions = await listVersions(page, projectId);
      await seedComment(page, versions[0].id, {
        selector: '.ethan-detail-header__title',
        text_excerpt: 'Open VM first',
        page_url: VMAS_URL,
        step: '',
        state: 'nav=Virtual machines|vm=azure-baboon-27',
        state_mode: 'declarative',
        x: 0.5,
        y: 0.5,
        body: 'Open VM first',
      });
      await seedComment(page, versions[0].id, {
        selector: 'article[aria-label="windows-golden-eider-58"]',
        text_excerpt: 'List comment',
        page_url: VMAS_URL,
        step: '',
        state: 'nav=Virtual machines',
        state_mode: 'declarative',
        x: 0.5,
        y: 0.5,
        body: 'List comment',
      });

      await page.getByText('VM close persona', { exact: true }).click();
      await page.getByText('Comment mode', { exact: true }).waitFor();
      const frame = page.frameLocator('iframe');
      await expect(frame.locator('[data-open-vm]').first()).toBeVisible({ timeout: 60_000 });

      // Enter the VM detail first.
      await page.getByText('Open VM first', { exact: true }).click();
      await expect(
        frame.locator('#view-vm.pf-m-active .ethan-detail-header__title'),
      ).toHaveText('azure-baboon-27', { timeout: 15_000 });

      // Then click the list comment: the bridge must leave the detail.
      await page.getByLabel('Back to all comments').click();
      await page.getByText('List comment', { exact: true }).click();
      await expect(frame.locator('#view-vms.pf-m-active')).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test('clicking a wizard-step comment opens the creation wizard', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'WizOpen', email: 'wiz-open@example.com', password: 'password123' });
      await createProject(page, 'Wizard open');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'Wizard open persona', VMAS_URL);

      const versions = await listVersions(page, projectId);
      await seedComment(page, versions[0].id, {
        selector: '.pf-v6-c-wizard__title-text',
        text_excerpt: 'Wizard step comment',
        page_url: VMAS_URL,
        step: 'Select template',
        state: 'nav=Virtual machines|step=Select template|tab=Details|wizard=1',
        state_mode: 'declarative',
        x: 0.5,
        y: 0.5,
        body: 'Wizard step comment',
      });

      await page.getByText('Wizard open persona', { exact: true }).click();
      await page.getByText('Comment mode', { exact: true }).waitFor();
      const frame = page.frameLocator('iframe');
      await expect(frame.locator('[data-open-vm]').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Wizard step comment', { exact: true })).toBeVisible();

      // Clicking the comment must open the wizard at the recorded step.
      await page.getByText('Wizard step comment', { exact: true }).click();
      await expect(frame.locator('#overlay.pf-m-open')).toBeVisible({ timeout: 15_000 });
      await expect(
        frame.locator('.pf-v6-c-wizard__nav-link.pf-m-current .pf-v6-c-wizard__nav-link-text'),
      ).toHaveText('Select template', { timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test('when the wizard cannot be auto-opened, guidance is shown', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signupViaUI(page, { name: 'WizGuide', email: 'wiz-guide@example.com', password: 'password123' });
      await createProject(page, 'Wizard guide');
      const projectId = projectIdFromUrl(page.url());
      await createPersona(page, 'Wizard guide persona', VMAS_URL);

      const versions = await listVersions(page, projectId);
      await seedComment(page, versions[0].id, {
        selector: '.catalog-card-specs',
        text_excerpt: 'Wizard guide comment',
        page_url: VMAS_URL,
        step: 'Select template',
        state: 'nav=Virtual machines|step=Select template|tab=Details|wizard=1',
        state_mode: 'declarative',
        x: 0.5,
        y: 0.5,
        body: 'Wizard guide comment',
      });

      await page.getByText('Wizard guide persona', { exact: true }).click();
      await page.getByText('Comment mode', { exact: true }).waitFor();
      const frame = page.frameLocator('iframe');
      await expect(frame.locator('[data-open-vm]').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Wizard guide comment', { exact: true })).toBeVisible();

      // Sabotage the wizard opener so the bridge can't auto-open it; it must
      // fall back to guiding the reviewer instead of failing silently.
      const iframeFrame = page.frames().find((f) => f !== page.mainFrame());
      await iframeFrame!.evaluate(() => {
        window.openWizard = undefined;
        document.getElementById('btn-create')?.remove();
      });

      await page.getByText('Wizard guide comment', { exact: true }).click();
      await expect(
        page.getByText(/This comment is inside the creation wizard/).first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});
