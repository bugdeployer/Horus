import { test, expect } from "@playwright/test";
import { seedCapture } from "./seed";
for (const runtime of ["typescript", "javascript", "php"]) {
  test(`${runtime} SDK captures are inspectable`, async ({ page, request }) => {
    const response = await seedCapture(request, runtime);
    expect(response.ok()).toBeTruthy();
    const capture = await response.json();
    await page.goto("/?capture=" + capture.id);
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run demo", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("captured events");
  });
}
test("setup covers supported runtimes without bundled demos", async ({
  page,
}) => {
  await page.goto("/?view=help");
  for (const name of [
    "Python",
    "TypeScript",
    "JavaScript",
    "Browser JS / TS",
    "PHP",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `1. Install · ${name}`, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "3. Exercise your app" }),
  ).toBeVisible();
});
