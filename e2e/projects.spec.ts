import { test, expect } from '@playwright/test';
import { OSAC_URL, createPersona, createProject, shareProject, signupViaUI } from './helpers';

test.describe('projects & personas', () => {
  test('create a project and add a persona', async ({ page }) => {
    await signupViaUI(page, { name: 'Owner', email: 'owner@example.com', password: 'password123' });

    await createProject(page, 'Marketing site');
    await createPersona(page, 'Homepage v1', OSAC_URL);

    await expect(page.getByText('Homepage v1', { exact: true })).toBeVisible();
    await expect(page.getByText(OSAC_URL, { exact: true })).toBeVisible();
  });

  test('share a project with another user', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const memberCtx = await browser.newContext();
    try {
      const owner = await ownerCtx.newPage();
      const member = await memberCtx.newPage();

      const ownerUser = { name: 'Owner2', email: 'owner2@example.com', password: 'password123' };
      const memberUser = { name: 'Viewer', email: 'viewer@example.com', password: 'password123' };

      // The member must already have an account before sharing.
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
});
