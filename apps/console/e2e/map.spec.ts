import { test, expect } from "@playwright/test";
import { seedCapture } from "./seed";
test("map explores captured structure, call evidence and usage heatmap", async ({
  page,
  request,
}) => {
  const c = await (await seedCapture(request)).json();
  await page.goto("/?view=map&capture=" + c.id);
  await expect(
    page.getByRole("heading", { name: "Map", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Captured structure" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Call flow", exact: true }).click();
  await page
    .getByLabel("Focus map block")
    .selectOption({ label: "tests.support.runtime.handle_order" });
  await expect(
    page.getByRole("img", { name: "Observed callers and callees" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/map-flow-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Usage heatmap", exact: true })
    .click();
  await page.getByLabel("Heatmap metric").selectOption("errors");
  await expect(
    page.getByRole("heading", { name: "Usage heatmap", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /tests.support.runtime.handle_order, .*errors:/,
    })
    .last()
    .click();
  await expect(page.getByLabel("Map block details")).toContainText(
    "duration samples",
  );
  await page.screenshot({
    path: "../../artifacts/map-heat-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "../../artifacts/map-heat-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page
    .getByLabel("Map block details")
    .getByRole("button", { name: /Open trace/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Trace", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Captured structure" }),
  ).toBeVisible();
  await page.getByLabel("Search map blocks").fill("normalize_order");
  await expect(
    page
      .getByLabel("Application map")
      .getByRole("button", { name: /normalize_order/ }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../artifacts/map-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
