import { seedCapture } from "./seed";
import { test, expect } from "@playwright/test";
test("project selection filters captures and setup prompt uses project name", async ({
  page,
  request,
}) => {
  const summary = await (await seedCapture(request)).json();
  const capture = await (
    await request.get(`/api/captures/${summary.id}/export`)
  ).json();
  capture.id = crypto.randomUUID();
  const project = "project-check-" + crypto.randomUUID();
  capture.application = project;
  await request.post("/api/captures", {
    data: capture,
    headers: { "X-Horus-Delivery": "automatic" },
  });
  await page.goto("/");
  await expect(
    page.getByLabel("Connected project").locator(`option[value="${project}"]`),
  ).toHaveCount(1);
  await page.getByLabel("Connected project").selectOption(project);
  await expect(page.getByLabel("Active capture")).toHaveValue(capture.id);
  await expect(page.getByLabel("Active capture").locator("option")).toHaveCount(
    1,
  );
  await expect(page.locator(".rt-project-selector")).toContainText(
    "Receiving captures",
  );
  await page.screenshot({
    path: "../../artifacts/project-selector.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByLabel("Prompt project name").fill("project-check");
  await expect(page.getByLabel("LLM setup prompt")).toContainText(
    "Project/application name: project-check",
  );
  await page.screenshot({
    path: "../../artifacts/llm-setup-prompt.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Copy setup prompt" }).click();
  await expect(page.locator(".rt-llm-prompt")).toContainText(
    /Prompt copied|Clipboard unavailable/,
  );
});
