/**
 * Captures the landing page's product shot (src/assets/editor-session.jpg)
 * from the REAL app: two accounts in one song, the second one's cursor on
 * the first one's grid. The landing page shows this instead of a drawn mock,
 * so the picture has to be regenerated when the editor's look changes —
 * that is what this script is for.
 *
 * It creates its own two throwaway accounts and its own song, so point it at
 * a LOCAL stack, never production:
 *   node e2e/landing-shot.mjs
 *   SHOT_BASE_URL=http://host:port node e2e/landing-shot.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:5173";
const OUT = fileURLToPath(new URL("../src/assets/editor-session.jpg", import.meta.url));
const PASSWORD = "landing-shot-password";
const HOST = { email: "landing-host@cotune.test", displayName: "Khoa" };
const GUEST = { email: "landing-guest@cotune.test", displayName: "Maya" };

async function call(path, body, token) {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** Log in, registering on first run. Returns the JWT. */
async function account({ email, displayName }) {
  let res = await call("/api/auth/login", { email, password: PASSWORD });
  if (res.status !== 200) {
    res = await call("/api/auth/register", { email, password: PASSWORD, displayName });
  }
  if (!res.json?.token) throw new Error(`could not sign in ${email}: ${res.status}`);
  return res.json.token;
}

async function graphql(token, query, variables) {
  const res = await call("/graphql", { query, variables }, token);
  if (res.json?.errors) throw new Error(JSON.stringify(res.json.errors));
  return res.json.data;
}

const hostToken = await account(HOST);
await account(GUEST);

// A fresh song each run, so the shot never depends on what a previous run
// left behind. The preset is inserted through the UI below — the same path
// a person takes.
const { createSong } = await graphql(
  hostToken,
  `mutation($input: CreateSongInput!) { createSong(input: $input) { id } }`,
  { input: { title: "Night Drive", bpm: 96, timeSignature: "4/4" } },
);
const songId = createSong.id;
await graphql(
  hostToken,
  `mutation($input: ShareSongInput!) { shareSong(input: $input) { userId } }`,
  { input: { songId, email: GUEST.email, role: "EDITOR" } },
);

const browser = await chromium.launch();
try {
  async function signedIn({ email }, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(BASE + "/login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/songs$/);
    await page.goto(`${BASE}/songs/${songId}`);
    await page.getByTitle("Build the beats").click();
    return page;
  }

  const host = await signedIn(HOST, { width: 1600, height: 1000 });
  // Fill the song from the preset library, exactly as a user would.
  await host.getByRole("button", { name: "Start from a preset" }).click();
  await host.locator("[role=dialog]").getByRole("button", { name: "Insert" }).nth(3).click();
  await host.waitForSelector("[data-testid=piano-roll]");
  await host.keyboard.press("Escape"); // leave the arm-to-place state
  await host.waitForTimeout(1500); // let the notes flush over the socket

  const guest = await signedIn(GUEST, { width: 1400, height: 900 });
  await guest.waitForSelector("[data-testid=piano-roll]");
  // Same lane on both screens, so the guest's cursor lands on the host's roll.
  // Picked by its NAME on the mixer strip: the strip is mostly faders, and a
  // click on its middle would move one.
  const lane = process.env.SHOT_LANE ?? "Phím";
  for (const page of [host, guest]) {
    await page.getByRole("group", { name: `${lane} channel` }).getByText(lane, { exact: true }).click();
  }
  await guest.waitForTimeout(400); // the roll scrolls the lane's notes into view
  // Next to a real note, so the cursor is on screen whatever the scroll.
  const note = await guest.locator("[data-testid=piano-roll] .note").first().boundingBox();
  // Hover, don't click: presence is a hover, and a click would write a note.
  await guest.mouse.move(note.x + 3 * 34 + 17, note.y - 26 + 11, { steps: 8 });
  await host.waitForSelector(".peer-cursor", { timeout: 10_000 });
  // Our own pointer out of the picture: over the empty pane right of the
  // roll, where it hovers nothing (a strip would show its delete button).
  await host.mouse.move(1590, 450);
  await host.waitForTimeout(600); // the cursor's glide transition settles
  await host.screenshot({ path: OUT, type: "jpeg", quality: 88 });
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
}
