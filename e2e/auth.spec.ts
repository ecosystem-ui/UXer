import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, logoutViaUI, signupViaUI } from './helpers';

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
