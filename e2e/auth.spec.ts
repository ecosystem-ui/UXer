import { test, expect, type Page } from '@playwright/test';
import {
  OSAC_URL,
  createPersona,
  createProject,
  loginViaUI,
  logoutViaUI,
  projectIdFromUrl,
  shareProject,
  signupViaUI,
} from './helpers';

async function openAvatarMenu(page: Page) {
  await page.locator('header button').last().click();
}

test.describe('authentication', () => {
  test('signup, logout, then login', async ({ page }) => {
    const user = { name: 'Alice', email: 'alice@example.com', password: 'password123' };

    await signupViaUI(page, user);
    await openAvatarMenu(page);
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await logoutViaUI(page);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    await loginViaUI(page, user);
    await openAvatarMenu(page);
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
  });

  test('a shared project link survives login', async ({ page }) => {
    const user = { name: 'Dana', email: 'dana@example.com', password: 'password123' };
    await signupViaUI(page, user);
    await createProject(page, 'Shared project');
    const projectId = projectIdFromUrl(page.url());
    await logoutViaUI(page);

    await page.goto(`/projects/${projectId}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/projects/${projectId}`);

    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await expect(page.getByRole('heading', { name: 'Shared project', exact: true })).toBeVisible();
  });

  test('a shared persona link survives login', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    try {
      const owner = await ownerCtx.newPage();
      const viewer = await viewerCtx.newPage();
      const ownerUser = { name: 'Olga', email: 'olga@example.com', password: 'password123' };
      const viewerUser = { name: 'Vic', email: 'vic@example.com', password: 'password123' };

      // The viewer needs an account before the project can be shared with them.
      await signupViaUI(viewer, viewerUser);
      await signupViaUI(owner, ownerUser);
      await createProject(owner, 'Persona project');
      const projectId = projectIdFromUrl(owner.url());
      await createPersona(owner, 'Checkout flow', OSAC_URL);
      const versions = await (
        await owner.request.get(`/api/projects/${projectId}/versions`)
      ).json();
      const versionId = versions[0].id as string;
      await shareProject(owner, viewerUser.email);
      await logoutViaUI(viewer);

      const personaPath = `/projects/${projectId}/versions/${versionId}`;
      await viewer.goto(personaPath);
      await expect(viewer).toHaveURL(/\/login\?next=/);
      expect(new URL(viewer.url()).searchParams.get('next')).toBe(personaPath);

      await viewer.getByLabel('Email').fill(viewerUser.email);
      await viewer.getByLabel('Password').fill(viewerUser.password);
      await viewer.getByRole('button', { name: 'Sign in', exact: true }).click();

      await expect(viewer).toHaveURL(new RegExp(`${personaPath}$`));
      await expect(viewer.getByText('Comment mode', { exact: true })).toBeVisible();
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });

  test('an off-site next target is ignored after login', async ({ page }) => {
    const user = { name: 'Fay', email: 'fay@example.com', password: 'password123' };
    await signupViaUI(page, user);
    await logoutViaUI(page);

    await page.goto('/login?next=//evil.example.com');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('login with a wrong password is rejected', async ({ page }) => {
    const user = { name: 'Bob', email: 'bob@example.com', password: 'password123' };

    await signupViaUI(page, user);
    await logoutViaUI(page);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByText('invalid email or password')).toBeVisible();
  });
});
