import { test, expect } from "@playwright/test";

test("grayscale themes persist across reloads and navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(12, 12, 14)",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();

  await page.screenshot({
    path: "../../artifacts/settings-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("horus.theme"))).toBe(
    "light",
  );
  await page.reload();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("light");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();

  await page.screenshot({
    path: "../../artifacts/settings-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "SDK setup", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../artifacts/setup-dark-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");
});

test("theme works when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
