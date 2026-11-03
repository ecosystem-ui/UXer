import { test, expect, type Page } from '@playwright/test';
import {
  OSAC_URL,
  USERS,
  createPersona,
  createProject,
  openPersona,
  openProject,
  openThread,
  projectIdFromUrl,
  replyToThread,
  resolveThread,
  seedComment,
  selectCommentFilter,
  shareProject,
  signupViaUI,
} from './helpers';

async function listVersions(page: Page, projectId: string) {
  const res = await page.request.get(`/api/projects/${projectId}/versions`);
  if (!res.ok()) throw new Error(`list versions failed: ${res.status()}`);
  return res.json();
}

test('three users collaborate across two shared projects', async ({ browser }) => {
  const [ana, ben, cat] = USERS;

  const anaCtx = await browser.newContext();
  const benCtx = await browser.newContext();
  const catCtx = await browser.newContext();
  try {
    const anaPage = await anaCtx.newPage();
    const benPage = await benCtx.newPage();
    const catPage = await catCtx.newPage();

    // 1. All three users sign up.
    await signupViaUI(anaPage, ana);
    await signupViaUI(benPage, ben);
    await signupViaUI(catPage, cat);

    // 2. Owner (Ana) creates two projects, each with a persona.
    await createProject(anaPage, 'Alpha');
    const alphaId = projectIdFromUrl(anaPage.url());
    await createPersona(anaPage, 'Alpha persona', OSAC_URL);
    await shareProject(anaPage, ben.email);
    await shareProject(anaPage, cat.email);

    await anaPage.goto('/');
    await createProject(anaPage, 'Beta');
    const betaId = projectIdFromUrl(anaPage.url());
    await createPersona(anaPage, 'Beta persona', OSAC_URL);
    await shareProject(anaPage, ben.email);
    await shareProject(anaPage, cat.email);

    // 3. Seed three threads via API (two in Alpha, one in Beta).
    const alphaVersions = await listVersions(anaPage, alphaId);
    const betaVersions = await listVersions(anaPage, betaId);
    const alphaVersionId = alphaVersions[0].id;
    const betaVersionId = betaVersions[0].id;

    const seed = (versionId: string, body: string) =>
      seedComment(anaPage, versionId, {
        selector: 'body',
        text_excerpt: body,
        page_url: OSAC_URL,
        step: '',
        x: 0.5,
        y: 0.5,
        body,
      });

    await seed(alphaVersionId, 'Alpha thread 1');
    await seed(alphaVersionId, 'Alpha thread 2');
    await seed(betaVersionId, 'Beta thread 1');

    // 4. All three users reply to the same thread ("Alpha thread 1").
    const repliers: Array<[Page, (typeof USERS)[number]]> = [
      [anaPage, ana],
      [benPage, ben],
      [catPage, cat],
    ];
    for (const [page, user] of repliers) {
      await openProject(page, 'Alpha');
      await openPersona(page, 'Alpha persona');
      await openThread(page, 'Alpha thread 1');
      await replyToThread(page, `Reply from ${user.name}`);
      await page.getByRole('button', { name: 'Back to all comments' }).click();
    }

    // 5. Each user resolves a different thread.
    await openThread(anaPage, 'Alpha thread 1');
    await resolveThread(anaPage);

    await openProject(benPage, 'Alpha');
    await openPersona(benPage, 'Alpha persona');
    await openThread(benPage, 'Alpha thread 2');
    await resolveThread(benPage);

    await openProject(catPage, 'Beta');
    await openPersona(catPage, 'Beta persona');
    await openThread(catPage, 'Beta thread 1');
    await resolveThread(catPage);

    // 6. Verify "Alpha thread 1" now shows the three replies and is resolved.
    await openProject(anaPage, 'Alpha');
    await openPersona(anaPage, 'Alpha persona');
    await selectCommentFilter(anaPage, 'all');
    await openThread(anaPage, 'Alpha thread 1');
    await expect(anaPage.getByText('Reply from Ana')).toBeVisible();
    await expect(anaPage.getByText('Reply from Ben')).toBeVisible();
    await expect(anaPage.getByText('Reply from Cat')).toBeVisible();
    await expect(anaPage.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  } finally {
    await anaCtx.close();
    await benCtx.close();
    await catCtx.close();
  }
});
