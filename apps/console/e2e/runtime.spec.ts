import { seedCapture } from "./seed";
import { test, expect } from "@playwright/test";

test("runtime overview, block inspection, trace checkpoints and saved capture", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const created = await (await seedCapture(request)).json();
  await page.goto("/?capture=" + created.id);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "checkout.transformed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "tests.support.runtime.normalize_order",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "tests.support.runtime.normalize_order",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inspect", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set baseline", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Compare with baseline", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Execution differences" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "$.output.currency", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open →", exact: true })
    .nth(1)
    .click();
  await expect(
    page.getByRole("heading", { name: "Trace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Failed expectation", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".rt-span-detail")).toContainText(
    "normalize_order",
  );
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".rt-code")).toContainText("def normalize_order");
  const saved = page.url();
  await page.reload();
  await expect(page.locator(".rt-span-detail")).toContainText(
    "normalize_order",
  );
  await expect(page).toHaveURL(saved);
  await page.screenshot({
    path: "../../artifacts/runtime-trace-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "../../artifacts/runtime-overview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../artifacts/runtime-overview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("settings persist and SDK exports import without a model", async ({
  page,
  request,
}) => {
  await page.goto("/?view=settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Maximum events", { exact: true }).fill("500");
  await page
    .getByLabel("Additional sensitive keys", { exact: true })
    .fill("customer_email, billing_name");
  await page
    .getByRole("button", { name: "Save capture defaults", exact: true })
    .click();
  await expect(page.locator(".rt-notice")).toContainText(
    "Capture defaults saved",
  );
  await page.reload();
  await expect(page.getByLabel("Maximum events", { exact: true })).toHaveValue(
    "500",
  );
  await expect(
    page.getByLabel("Additional sensitive keys", { exact: true }),
  ).toHaveValue("customer_email, billing_name");
  const created = await seedCapture(request);
  const summary = await created.json();
  const exported = await request.get(`/api/captures/${summary.id}/export`);
  await page.locator("input[type=file]").setInputFiles({
    name: "capture.json",
    mimeType: "application/json",
    buffer: Buffer.from(await exported.text()),
  });
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("45 captured events");
  await page
    .getByRole("button", { name: /Captures/, exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Captures", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Export JSON", exact: true }).first(),
  ).toBeVisible();
});
