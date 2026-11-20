import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.TEST_BASE_URL || "http://localhost:3000";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const assert = (v, m) => { if (!v) throw new Error("FAIL " + m); console.log("PASS", m); };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  for (const [provider, label] of [["anima","Anima"],["kodik","Kodik"],["senku","Senku"],["anilibria","AniLibria"]]) {
    await page.goto(`${base}/anime/52991`, { waitUntil: "domcontentloaded" });
    // switch provider tab
    await page.locator(".provider-tabs button").filter({ hasText: label }).first().click();
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2;
    }, undefined, { timeout: 45000 });
    await page.getByRole("button", { name: "Воспроизвести видео", exact: true }).click();
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.videoHeight > 0 && v.currentTime > 0.3 && !v.paused;
    }, undefined, { timeout: 45000 });
    const info = await page.evaluate(() => {
      const v = document.querySelector("video");
      return { h: v.videoHeight, w: v.videoWidth, t: v.currentTime, dur: v.duration, err: v.error?.code ?? null };
    });
    assert(info.err === null, `${label}: no media error`);
    assert(info.t > 0.3, `${label}: playback advances (${info.t.toFixed(2)}s)`);
    assert(info.w > 0, `${label}: video decoded ${info.w}x${info.h}`);
    // A real episode is ~26 min; the local 4K demo clip is only 30s, so a
    // short duration means auto-level fell into the demo instead of the anime.
    assert(info.dur > 600, `${label}: full episode duration (${Math.round(info.dur)}s), not the 30s demo`);
    console.log(`   -> ${label}: ${info.w}x${info.h}, duration=${Math.round(info.dur)}s`);
    await page.getByRole("button", { name: "Пауза", exact: true }).click();
  }

  // quality menu sanity on Anima
  await page.goto(`${base}/anime/52991`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1, undefined, { timeout: 45000 });
  await page.getByRole("button", { name: "Качество видео", exact: true }).click();
  const labels = await page.locator(".quality-menu button").allInnerTexts();
  console.log("   quality menu:", labels.join(" | "));
  assert(labels.some((t) => t.includes("2160")), "quality menu offers 4K");
  assert(labels.some((t) => t.includes("1440")), "quality menu offers 2K");
  assert(labels.some((t) => t.includes("380p")), "quality menu offers 380p");
  await page.getByRole("button", { name: "Качество видео", exact: true }).click();

  // skip opening button appears for an episode with known timings
  const skipVisible = await page.locator(".skip-intro").count();
  console.log("   skip-opening controls present:", skipVisible > 0 ? "yes" : "not yet (time < 0s)");

  assert(errors.length === 0, `no page errors (${errors.join("; ")})`);
  await page.screenshot({ path: "artifacts/players-fixed.png" });
  console.log("ALL PLAYER CHECKS PASSED");
} finally {
  await browser.close();
}
