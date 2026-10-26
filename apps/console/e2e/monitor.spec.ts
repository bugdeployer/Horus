import { test, expect } from "@playwright/test";
import { seedCapture } from "./seed";
test("monitor charts filter and link to traces without demo controls", async ({
  page,
  request,
}) => {
  const seed = await (await seedCapture(request)).json();
  const capture = await (
    await request.get("/api/captures/" + seed.id + "/export")
  ).json();
  capture.id = crypto.randomUUID();
  capture.application = "monitor-test-" + crypto.randomUUID();
  await request.post("/api/captures", { data: capture });
  await page.goto(
    "/?view=monitor&project=" + capture.application + "&capture=" + capture.id,
  );
  await expect(
    page.getByRole("heading", { name: "Monitor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Observed executions over time" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Median and p95 execution duration over time",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open trace →" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause display" }).click();
  await expect(page.getByText("Display paused", { exact: true })).toBeVisible();
  await page.getByLabel("Filter monitor activity").selectOption("expectations");
  await expect(
    page.getByRole("row").filter({ hasText: "checkout.transformed" }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "../../artifacts/monitor-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.getByLabel("Monitor window")).toHaveCSS(
    "background-color",
    "rgb(243, 243, 244)",
  );
  await page.screenshot({
    path: "../../artifacts/monitor-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "Open trace →" }).click();
  await expect(
    page.getByRole("heading", { name: "Trace", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Monitor", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Monitor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Capture health", exact: true }),
  ).toBeAttached();
  await page.screenshot({
    path: "../../artifacts/monitor-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "Activity", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../../artifacts/monitor-activity-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel("Horus", { exact: true })).toBeVisible();
});
