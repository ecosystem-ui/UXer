import { test, expect } from '@playwright/test';
import {
  OSAC_URL,
  createPersona,
  createProject,
  openPersona,
  openProject,
  shareProject,
  signupViaUI,
} from './helpers';

test.describe('projects & personas', () => {
  test('create a project and add a persona', async ({ page }) => {
    await signupViaUI(page, { name: 'Owner', email: 'owner@example.com', password: 'password123' });

    await createProject(page, 'Marketing site');
    await createPersona(page, 'Homepage v1', OSAC_URL);

    await expect(page.getByText('Homepage v1', { exact: true })).toBeVisible();
    await expect(page.getByText(OSAC_URL, { exact: true })).toBeVisible();
  });

  test('copy the share link from the share dialog', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signupViaUI(page, { name: 'Linker', email: 'linker@example.com', password: 'password123' });

    await createProject(page, 'Copy link project');
    await page.getByRole('button', { name: 'Share' }).click();

    const copyButton = page.getByRole('button', { name: 'Copy link' });
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(page.url());
  });

  test('share a project with another user', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const memberCtx = await browser.newContext();
    try {
      const owner = await ownerCtx.newPage();
      const member = await memberCtx.newPage();

      const ownerUser = { name: 'Owner2', email: 'owner2@example.com', password: 'password123' };
      const memberUser = { name: 'Viewer', email: 'viewer@example.com', password: 'password123' };

      // The member already has an account in this scenario.
      await signupViaUI(member, memberUser);
      await signupViaUI(owner, ownerUser);

      await createProject(owner, 'Shared project');
      await shareProject(owner, memberUser.email);

      // The member now sees the shared project on their home page.
      await member.goto('/');
      await expect(member.getByRole('heading', { name: 'Shared project' })).toBeVisible();
      await expect(member.getByText(`Shared by ${ownerUser.name}`)).toBeVisible();
    } finally {
      await ownerCtx.close();
      await memberCtx.close();
    }
  });

  test('share a project from a persona page', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    try {
      const owner = await ownerCtx.newPage();
      const viewer = await viewerCtx.newPage();

      const ownerUser = { name: 'Grace', email: 'grace@example.com', password: 'password123' };
      const viewerUser = { name: 'Henry', email: 'henry@example.com', password: 'password123' };

      // The viewer already has an account in this scenario.
      await signupViaUI(viewer, viewerUser);
      await signupViaUI(owner, ownerUser);
      await createProject(owner, 'Persona share');
      await createPersona(owner, 'Homepage v2', OSAC_URL);

      // The Share button lives on the persona detail page too.
      await openPersona(owner, 'Homepage v2');
      await shareProject(owner, viewerUser.email);

      await openProject(viewer, 'Persona share');
      await openPersona(viewer, 'Homepage v2');
      await expect(viewer.getByRole('button', { name: 'Share' })).toHaveCount(0);
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });

  test('invite someone before they sign up', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const invitedCtx = await browser.newContext();
    try {
      const owner = await ownerCtx.newPage();
      const invited = await invitedCtx.newPage();

      const ownerUser = { name: 'Ivy', email: 'ivy@example.com', password: 'password123' };
      const invitedUser = { name: 'Jack', email: 'jack@example.com', password: 'password123' };

      await signupViaUI(owner, ownerUser);
      await createProject(owner, 'Pending invite');

      // The invited person has no account yet, so the row is pending.
      await shareProject(owner, invitedUser.email, 'invited');

      // Signing up with the invited address grants viewer access immediately.
      await signupViaUI(invited, invitedUser);
      await expect(invited.getByRole('heading', { name: 'Pending invite' })).toBeVisible();
      await expect(invited.getByText(`Shared by ${ownerUser.name}`)).toBeVisible();
      await openProject(invited, 'Pending invite');
      await expect(invited.getByRole('button', { name: 'Share' })).toHaveCount(0);

      // The owner now sees a resolved membership rather than a pending invite.
      await owner.goto('/');
      await openProject(owner, 'Pending invite');
      await owner.getByRole('button', { name: 'Share' }).click();
      await expect(owner.getByText(`${invitedUser.email} · viewer`)).toBeVisible();
    } finally {
      await ownerCtx.close();
      await invitedCtx.close();
    }
  });
});
