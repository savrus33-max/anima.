import { chromium } from "playwright";

const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const assert = (v, m) => { if (!v) throw new Error("FAIL " + m); console.log("PASS", m); };

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = (p) => `${base}/api/service?path=${encodeURIComponent(p)}`;

  // Register through the UI so the secure session cookie is really stored.
  const email = `crop-${Date.now()}@anima.test`;
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.getByPlaceholder("Твой никнейм").fill("Кроппер");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Не менее 8 символов").fill("Test-Anima-2026!");
  await page.locator(".auth-modal form button[type=submit]").click();
  await page.waitForSelector(".demo-code strong", { timeout: 15000 });
  const code = (await page.locator(".demo-code strong").textContent()).trim();
  await page.getByPlaceholder("000000").fill(code);
  await page.getByRole("button", { name: "Подтвердить почту", exact: true }).click();
  await page.waitForSelector(".header-profile", { timeout: 15000 });
  assert(true, "registration + email code verification completed");

  await page.goto(`${base}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".profile-settings", { timeout: 15000 });

  // preset emoji avatars must be gone
  assert((await page.locator(".avatar-picker").count()) === 0, "preset emoji avatar picker removed");
  assert((await page.locator(".avatar-upload-row").count()) === 1, "photo upload row present");

  // no emoji glyph anywhere in rendered avatars
  const glyphs = await page.locator(".avatar").allInnerTexts();
  assert(!glyphs.some((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)), "no emoji avatars rendered");

  // upload a photo -> circular cropper opens
  await page.setInputFiles('input[type="file"]', "public/images/posters/52991.jpg");
  await page.waitForSelector(".crop-stage", { timeout: 15000 });
  assert(await page.locator(".crop-ring").isVisible(), "circular crop mask shown");
  assert((await page.locator('input[type="range"]').count()) >= 1, "zoom control present");

  // drag the image inside the circle
  const stage = page.locator(".crop-stage");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 25, { steps: 6 });
  await page.mouse.up();
  const zoom = page.locator('.crop-stage ~ .crop-controls input[type="range"]').first();
  await zoom.fill("1.6");
  await page.screenshot({ path: "artifacts/avatar-crop.png" });

  await page.getByRole("button", { name: "Сделать аватаром", exact: true }).click();
  await page.waitForSelector(".crop-stage", { state: "detached", timeout: 10000 });

  const cropped = await page.locator(".profile-heading .avatar img").getAttribute("src");
  assert(cropped?.startsWith("data:image/webp"), "cropped photo stored as avatar");
  const dims = await page.evaluate((src) => new Promise((r) => {
    const i = new Image();
    i.onload = () => r([i.naturalWidth, i.naturalHeight]);
    i.src = src;
  }), cropped);
  assert(dims[0] === 512 && dims[1] === 512, `avatar exported at 512×512 (got ${dims[0]}×${dims[1]})`);

  // persist it
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".settings-save button[disabled]"), undefined, { timeout: 15000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".profile-heading .avatar img", { timeout: 15000 });
  const persisted = await page.locator(".profile-heading .avatar img").getAttribute("src");
  assert(persisted?.startsWith("data:image/webp"), "cropped avatar survives reload");

  assert(errors.length === 0, `no page errors (${errors.join("; ")})`);
  console.log("ALL AVATAR CHECKS PASSED");
} finally {
  await browser.close();
}
