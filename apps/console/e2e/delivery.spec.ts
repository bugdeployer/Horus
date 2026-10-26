import { seedCapture } from "./seed";
import { test, expect } from "@playwright/test";
test("incoming captures update the console and follow latest is optional", async ({
  page,
  request,
}) => {
  const seed = await (await seedCapture(request)).json();
  const template = await (
    await request.get(`/api/captures/${seed.id}/export`)
  ).json();
  const application = "delivery-" + crypto.randomUUID();
  template.application = application;
  template.id = crypto.randomUUID();
  await request.post("/api/captures", { data: template });
  await page.goto("/?project=" + application);
  await expect(page.getByLabel("Active capture")).toBeEnabled();
  await page.getByLabel("Follow latest", { exact: true }).check();
  template.id = crypto.randomUUID();
  const response = await request.post("/api/captures", { data: template });
  const capture = await response.json();
  await expect(page.getByLabel("Active capture")).toHaveValue(capture.id, {
    timeout: 10000,
  });
  await expect(page.locator(".rt-bottom")).toContainText("Connected");
  await page.getByLabel("Follow latest", { exact: true }).uncheck();
  template.id = crypto.randomUUID();
  const other = await (
    await request.post("/api/captures", { data: template })
  ).json();
  await expect(
    page.getByLabel("Active capture").locator(`option[value="${other.id}"]`),
  ).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByLabel("Active capture")).toHaveValue(capture.id);
});
