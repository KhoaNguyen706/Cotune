/**
 * The smoke test: one real browser walking the one path everything depends
 * on — register → create a song → open it → socket up → draw a note — with
 * ZERO console errors tolerated along the way.
 *
 * This exists because of the hooks-refactor reload loop: `tsc` passed, the
 * build passed, and the app was unusable. Only a browser executing the real
 * render loop catches that class of bug, so a browser now runs on every
 * push (ROADMAP Phase 1, item 5).
 *
 * Deliberately a plain Node script on the `playwright` LIBRARY (already a
 * devDependency), not a @playwright/test suite: there is exactly one
 * scenario, its assertion is "the happy path works end to end", and a
 * test-runner's fixtures/parallelism/reporters would be scaffolding around
 * a single straight line. If a second scenario ever appears, graduate.
 *
 * Run it against any live stack:
 *   node e2e/smoke.mjs                          (vite dev server, default)
 *   SMOKE_BASE_URL=http://host:port node e2e/smoke.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:5173";
// One clock for the whole script: a smoke that can hang is a smoke that
// blocks every push behind a 6h CI timeout.
const DEADLINE_MS = 120_000;

const errors = [];
let failed = false;

const timer = setTimeout(() => {
  console.error(`SMOKE: exceeded ${DEADLINE_MS / 1000}s deadline`);
  process.exit(1);
}, DEADLINE_MS);
timer.unref?.();

const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  // The "zero console errors" half of the contract. pageerror is an
  // uncaught exception — the reload loop's signature; console.error is the
  // app (or React) reporting that something it needed went wrong.
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  const email = `smoke-${Date.now()}@example.com`;
  const step = (name) => console.log(`SMOKE: ${name}`);

  step("register a fresh account");
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder("DJ Latenight").fill("Smoke Tester");
  await page.getByPlaceholder("you@band.com").fill(email);
  await page.getByPlaceholder("8+ characters").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "My songs" }).waitFor();

  step("create a song");
  // Two ways in (header button + the empty grid's dashed card) — either
  // opens the same modal; take whichever is first.
  await page.getByRole("button", { name: "+ New song" }).first().click();
  await page.getByPlaceholder("Midnight Sketch").fill("Smoke Song");
  await page.getByRole("button", { name: "Create song" }).click();

  step("open it");
  await page.getByRole("link", { name: "Open Smoke Song", exact: true }).click();

  // The socket has to come up BEFORE we edit: this badge turning "live" is
  // the STOMP CONNECT round trip completing over the real handshake — the
  // layer no jsdom test and no HTTP integration test crosses.
  step("wait for the socket");
  await page.getByTestId("socket-status").getByText("live", { exact: true }).waitFor();

  step("build a beat and a lane");
  // The page opens on the arrangement; beats are built in the other view.
  await page.getByTitle("Build the beats").click();
  await page.getByTitle("New beat").click();
  await page.getByPlaceholder("808 Kick").fill("Kick");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // Select the lane (the roll draws into the SELECTED lane; don't rely on
  // any auto-selection behavior staying the way it happens to be today).
  // .first() = the sidebar row; the name may also appear in the rack.
  await page.getByText("Kick", { exact: true }).first().click();

  step("draw a note");
  const roll = page.getByTestId("piano-roll");
  await roll.waitFor();
  const box = await roll.boundingBox();
  // A mousedown two cells in: lands mid-cell regardless of exact cell
  // geometry, far enough from the edge to never hit a neighbour's border.
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator(".note").first().waitFor();

  // Give the auto-save + broadcast a beat to surface any async failure
  // before we stop listening for console errors.
  await page.waitForTimeout(1000);

  if (errors.length > 0) {
    console.error(`SMOKE: FAILED — ${errors.length} console error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    failed = true;
  } else {
    console.log("SMOKE: PASSED — full path, zero console errors");
  }
} catch (err) {
  console.error(`SMOKE: FAILED — ${err.message}`);
  if (errors.length > 0) {
    console.error("Console errors seen before the failure:");
    for (const e of errors) console.error(`  ${e}`);
  }
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
