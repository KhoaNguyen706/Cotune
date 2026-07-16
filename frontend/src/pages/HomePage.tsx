import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
// Imported HERE and not in main.tsx on purpose: an @font-face rule costs
// nothing until something renders text in that family, so the app's own
// screens never fetch these two — only this page does. Self-hosted, same
// reasoning as Inter (see main.tsx).
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

/**
 * The PUBLIC front door. Until this existed, / redirected straight to
 * /login: a stranger's first frame was a password prompt for a product
 * they had never heard of, and the only honest response to that is to
 * close the tab.
 *
 * EVERYONE sees it, signed in or out (see App.tsx) — it is the front door,
 * not a thing you get redirected past. What changes when you are signed in
 * is only the calls to action: a person who already has an account does not
 * need to be sold, they need the way in. So "Start a session" becomes "Open
 * my songs" and the sign-in link disappears. The page is otherwise identical,
 * because the pitch is still the point of the page.
 *
 * It is deliberately its own visual world — the warm-black-and-lime
 * "studio" palette in styles.css, Space Grotesk and JetBrains Mono, fixed
 * dark in both themes. The app proper is cool violet and follows the theme
 * toggle. That is not drift: this page is a poster with ten seconds to say
 * what Cotune is, and the app is a room you sit in all afternoon. See the
 * studio-* token block for the rules that keep the two from bleeding.
 *
 * Outside AppShell for the same reason: the shell is a workstation layout
 * whose panes scroll internally and whose page never scrolls. A landing
 * page is a DOCUMENT. #root is h-screen + overflow-hidden, so it opts into
 * its own scroll container the way .page-center does.
 */
export function HomePage() {
  return (
    <div className="h-full overflow-y-auto bg-studio-bg font-display text-studio-text antialiased">
      {/* relative + overflow-x-hidden: the ambient glow below is wider than
          the viewport on a phone and would otherwise scroll the page
          sideways. */}
      <div className="relative overflow-x-hidden">
        {/* Ambient top glow — depth without imagery. Behind everything, and
            untouchable, or it would eat the nav's clicks. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[260px] left-1/2 h-[520px] w-[900px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(50% 50% at 50% 50%, color-mix(in oklch, var(--color-studio-lime) 10%, transparent), transparent 70%)",
          }}
        />
        <Nav />
        <Hero />
        <Stats />
        <Collab />
        <Features />
        <CtaBand />
        <Footer />
      </div>
    </div>
  );
}

/* ---------- shared atoms ---------- */

const SHELL = "relative mx-auto w-full max-w-[1180px] px-8 max-md:px-5";

/** The mono eyebrow above every section heading. */
function Eyebrow({ tone = "dim", children }: { tone?: "dim" | "lime"; children: React.ReactNode }) {
  return (
    <div
      className={`font-mono text-[11px] uppercase tracking-[0.14em] ${
        tone === "lime" ? "text-studio-lime" : "text-studio-dim"
      }`}
    >
      {children}
    </div>
  );
}

/** The lime pill button. An <a> styled as a button, because every one of
 *  these navigates — a <button> that routes is a link wearing a costume. */
function Cta({
  to,
  children,
  size = "md",
}: {
  to: string;
  children: React.ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center rounded-[10px] bg-studio-lime font-semibold text-studio-bg transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime focus-visible:ring-offset-2 focus-visible:ring-offset-studio-bg active:scale-[0.98] ${
        size === "lg" ? "px-[30px] py-[15px] text-[15px]" : "px-[18px] py-[10px] text-sm"
      }`}
      style={{ boxShadow: "0 0 34px -8px var(--color-studio-lime)" }}
    >
      {children}
    </Link>
  );
}

/** The outlined secondary. Same geometry as Cta so the pair sits level. */
function GhostCta({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-[10px] border border-studio-edge-3 px-[28px] py-[14px] text-[15px] font-medium text-studio-text transition-colors duration-150 hover:border-studio-lime hover:text-studio-lime focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
    >
      {children}
    </Link>
  );
}

/** The blinking "session is live" dot, next to the wordmark and above the
 *  sequencer mock. */
function LiveDot({ size = 11, blink = true }: { size?: number; blink?: boolean }) {
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full bg-studio-lime ${blink ? "animate-[blink_2.4s_ease-in-out_infinite]" : ""}`}
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 14px -1px var(--color-studio-lime)`,
      }}
    />
  );
}

/* ---------- the sequencer mock ---------- */

interface Lane {
  name: string;
  steps: number[];
}
interface MockCursor {
  name: string;
  color: string;
  row: number;
  left: string;
}

const CELL_H = 24;
const ROW_GAP = 6;

/**
 * The hero's centrepiece: a fake 16-step grid with a travelling playhead
 * and two collaborators' cursors parked on it.
 *
 * It is a MOCK, and it says so by being pure markup with no audio and no
 * socket — the real grid is BeatEditorCanvas. What it has to do is tell
 * the truth about the shape of the product in one glance: lanes down the
 * side, steps across, someone else's cursor already in your session.
 */
function Sequencer({
  title,
  lanes,
  cursors,
}: {
  title: string;
  lanes: Lane[];
  cursors: MockCursor[];
}) {
  return (
    <div
      className="rounded-2xl border border-studio-edge-2 bg-studio-panel px-[22px] pb-6 pt-5"
      style={{ boxShadow: "0 30px 70px -30px rgb(0 0 0 / 0.6)" }}
    >
      {/* title bar — the fake window chrome that makes it read as an app */}
      <div className="mb-[18px] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LiveDot size={7} />
          <span className="font-mono text-xs text-studio-muted">{title}</span>
        </div>
        <div className="flex gap-[5px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-studio-edge-3" />
          ))}
        </div>
      </div>

      <div className="flex">
        {/* lane labels */}
        <div className="mr-3 flex shrink-0 flex-col" style={{ gap: ROW_GAP }}>
          {lanes.map((lane) => (
            <span
              key={lane.name}
              className="flex items-center whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.06em] text-studio-dim"
              style={{ height: CELL_H }}
            >
              {lane.name}
            </span>
          ))}
        </div>

        {/* the grid itself: relative, because the playhead and the cursors
            are positioned against it */}
        <div className="relative flex min-w-0 flex-1 flex-col" style={{ gap: ROW_GAP }}>
          {lanes.map((lane) => (
            <div key={lane.name} className="flex gap-[5px]" style={{ height: CELL_H }}>
              {lane.steps.map((on, si) => (
                <span
                  key={si}
                  className={`flex-1 rounded ${on ? "bg-studio-lime" : "border border-studio-edge-2 bg-studio-cell"}`}
                  style={{
                    boxShadow: on ? "0 0 12px -3px var(--color-studio-lime)" : undefined,
                    // Every 4th step starts a bar. The brighter left edge is
                    // what lets you count beats instead of seeing a field of
                    // squares — the same rule the real grid uses (.cell.bar).
                    borderLeftColor:
                      si % 4 === 0 && !on ? "var(--color-studio-edge-3)" : undefined,
                  }}
                />
              ))}
            </div>
          ))}

          {/* playhead */}
          <div
            aria-hidden
            className="absolute -top-1 -bottom-1 w-0.5 animate-[sweep_3.4s_linear_infinite] bg-studio-lime opacity-90"
            style={{ boxShadow: "0 0 14px 1px var(--color-studio-lime)" }}
          />

          {/* collaborators */}
          {cursors.map((cursor, ci) => (
            <div
              key={cursor.name}
              aria-hidden
              className="absolute z-3 flex items-start"
              style={{
                top: cursor.row * (CELL_H + ROW_GAP) + 2,
                left: cursor.left,
                animation: `floaty ${3 + ci}s ease-in-out infinite`,
              }}
            >
              <span
                className="mt-[3px] -mr-[3px] h-[9px] w-[9px] rotate-45 rounded-[1px]"
                style={{ background: cursor.color }}
              />
              <span
                className="whitespace-nowrap rounded-[5px] px-[7px] py-[3px] font-mono text-[10px] font-semibold text-studio-bg"
                style={{ background: cursor.color, boxShadow: "0 2px 8px rgb(0 0 0 / 0.35)" }}
              >
                {cursor.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- sections ---------- */

function Nav() {
  const { user } = useAuth();

  return (
    <nav className={`${SHELL} flex items-center justify-between gap-6 py-[26px]`}>
      <Link
        to="/"
        aria-label="Cotune home"
        className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
      >
        <LiveDot />
        <span className="text-xl font-bold tracking-[-0.01em]">Cotune</span>
      </Link>

      {/* Only anchors that land somewhere real. The mock had Pricing and
          Changelog too; there is no pricing and no changelog, and a nav
          full of dead links is worse than a short nav. */}
      <div className="flex items-center gap-[30px] text-sm text-studio-muted max-md:hidden">
        <a href="#collab" className="transition-colors hover:text-studio-lime">
          Collaboration
        </a>
        <a href="#features" className="transition-colors hover:text-studio-lime">
          Features
        </a>
      </div>

      {user ? (
        // Signed in: one button, and it's the door. Offering "Sign in" to
        // someone who is signed in is how a landing page tells you it doesn't
        // know who you are.
        <Cta to="/songs">Open my songs</Cta>
      ) : (
        <div className="flex items-center gap-[18px]">
          <Link
            to="/login"
            className="rounded text-sm text-studio-text transition-colors hover:text-studio-lime focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
          >
            Sign in
          </Link>
          <span className="max-md:hidden">
            <Cta to="/register">Start a session</Cta>
          </span>
        </div>
      )}
    </nav>
  );
}

const HERO_LANES: Lane[] = [
  { name: "Kick", steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] },
  { name: "Snare", steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  { name: "Hat", steps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1] },
  { name: "Clap", steps: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0] },
  { name: "Bass", steps: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0] },
];

function Hero() {
  const { user } = useAuth();

  return (
    <header className={`${SHELL} flex flex-wrap items-center gap-14 pb-10 pt-14 max-md:gap-8 max-md:pt-6`}>
      <div className="min-w-[320px] flex-1 basis-[420px] max-md:min-w-0 max-md:basis-full">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-studio-edge-2 px-3.5 py-[7px] font-mono text-[11px] uppercase tracking-[0.14em] text-studio-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-studio-lime" />
          Collaborative beat studio
        </div>

        <h1 className="mt-[26px] text-[clamp(38px,6.2vw,66px)] font-bold leading-[0.98] tracking-[-0.03em] text-balance">
          Make the beat <span className="text-studio-lime">together</span>, in real time.
        </h1>

        <p className="mt-6 max-w-[500px] text-lg leading-[1.55] text-studio-muted text-pretty max-md:text-base">
          A browser-based beat studio where your whole crew edits the same pattern at
          once — every note, every step, live. No installs, no bouncing files back and
          forth.
        </p>

        <div className="mt-[34px] flex flex-wrap items-center gap-3.5">
          {user ? (
            <Cta to="/songs" size="lg">
              Open my songs
            </Cta>
          ) : (
            <>
              <Cta to="/register" size="lg">
                Start a session
              </Cta>
              {/* The mock's second CTA was "Hear a demo loop". There is no
                  demo loop to hear, so this is the honest version. */}
              <GhostCta to="/login">I have an account</GhostCta>
            </>
          )}
        </div>

        <p className="mt-5 font-mono text-xs text-studio-dim">
          {user
            ? `Signed in as ${user.displayName}`
            : "Free · runs in any modern browser"}
        </p>
      </div>

      <div className="min-w-[340px] flex-1 basis-[440px] max-md:min-w-0 max-md:basis-full">
        <Sequencer
          title="session · loop_01.beat"
          lanes={HERO_LANES}
          cursors={[
            { name: "maya", color: "var(--color-studio-lime)", row: 0, left: "52%" },
            { name: "dev", color: "var(--color-studio-amber)", row: 3, left: "86%" },
          ]}
        />
      </div>
    </header>
  );
}

/** Four claims, each one true of the app as it stands today. */
const STATS = [
  { v: "Live", l: "note-by-note sync" },
  { v: "∞", l: "collaborators per song" },
  { v: "0", l: "installs required" },
  { v: "FL-style", l: "pattern workflow" },
];

function Stats() {
  return (
    <section className={`${SHELL} mt-6`}>
      {/* 4-up on desktop, 2-up on phones — four 30px numbers across 375px
          would each be three characters wide. */}
      <div className="grid grid-cols-4 border-y border-studio-edge max-md:grid-cols-2">
        {STATS.map((stat) => (
          <div key={stat.l} className="border-r border-studio-edge px-5 py-[26px] last:border-r-0 max-md:border-b max-md:[&:nth-child(2)]:border-r-0">
            <div className="text-3xl font-bold tracking-[-0.02em]">{stat.v}</div>
            <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-studio-dim">
              {stat.l}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const COLLAB_LANES: Lane[] = [
  { name: "Kick", steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { name: "Clap", steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0] },
  { name: "Hat", steps: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
];

/** Each of these is a real, shipped mechanism — 02 is the diff/op path in
 *  realtime/socket.ts and TrackServiceImpl.applyNote, not an aspiration. */
const COLLAB_POINTS = [
  {
    n: "01",
    t: "Live cursors & presence",
    d: "See who's in the room and exactly which step they're touching.",
  },
  {
    n: "02",
    t: "Per-note sync, no clobbering",
    d: "Every edit travels as its own op — concurrent changes merge instead of overwriting.",
  },
  {
    n: "03",
    t: "Chat next to the beat",
    d: "Talk about the loop right where you make it, without leaving the studio.",
  },
];

function Collab() {
  return (
    <section id="collab" className={`${SHELL} mt-24 flex flex-wrap items-center gap-15 max-md:mt-16 max-md:gap-8`}>
      {/* Text first in the DOM (so a screen reader and a phone both get the
          point before the decoration), art first on desktop via order. */}
      <div className="min-w-[320px] flex-1 basis-[380px] max-md:min-w-0 max-md:basis-full md:order-2">
        <Sequencer
          title="shared · verse.beat"
          lanes={COLLAB_LANES}
          cursors={[
            { name: "maya", color: "var(--color-studio-lime)", row: 1, left: "44%" },
            { name: "dev", color: "var(--color-studio-amber)", row: 2, left: "68%" },
          ]}
        />
      </div>

      <div className="min-w-[320px] flex-1 basis-[380px] max-md:min-w-0 max-md:basis-full md:order-1">
        <Eyebrow tone="lime">Real-time collaboration</Eyebrow>
        <h2 className="mt-4 text-[clamp(30px,3.6vw,44px)] font-bold leading-[1.02] tracking-[-0.025em]">
          Everyone on the same grid.
        </h2>
        <p className="mt-5 max-w-[460px] text-[17px] leading-[1.6] text-studio-muted text-pretty">
          Cotune syncs the studio note by note. When someone drops a kick, it lands on
          your grid the instant they place it — no clobbering, no lost edits, no "who
          saved last."
        </p>

        <div className="mt-[30px] flex flex-col">
          {COLLAB_POINTS.map((point) => (
            <div key={point.n} className="flex gap-3.5 border-t border-studio-edge py-4">
              <span className="pt-0.5 font-mono text-xs text-studio-lime">{point.n}</span>
              <div>
                <div className="font-semibold">{point.t}</div>
                <div className="mt-1 text-sm leading-[1.5] text-studio-dim">{point.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Six shipped capabilities. Every claim here was checked against the code
 *  before it was written — a landing page that promises a feature the app
 *  doesn't have is a bug report scheduled for later. */
const FEATURES = [
  {
    n: "01",
    t: "Pattern workflow",
    d: "Song → beats → timeline. Build multi-lane patterns and arrange whole beats or audio clips, FL-style.",
  },
  {
    n: "02",
    t: "AI pattern generation",
    d: 'Describe the groove — "boom bap with an offbeat clap" — and get a starting pattern you can edit like any other.',
  },
  {
    n: "03",
    t: "Public listen links",
    d: "Mint a shareable link so anyone can play your sketch in the browser. Revoke it anytime.",
  },
  {
    n: "04",
    t: "Version history",
    d: "Every change is recorded and attributed. Scrub back and restore any past state of a lane in one click.",
  },
  {
    n: "05",
    t: "Per-lane mixer",
    d: "Volume and pan on every lane, saved with the song and heard by everyone — including listeners.",
  },
  {
    n: "06",
    t: "Browser-native audio",
    d: "A full Tone.js engine runs client-side. Play, tweak, and export to MP3 without installing a thing.",
  },
];

function Features() {
  return (
    <section id="features" className={`${SHELL} mt-28 max-md:mt-16`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Everything in the studio</Eyebrow>
          <h2 className="mt-3.5 text-[clamp(28px,3.2vw,40px)] font-bold tracking-[-0.025em]">
            Built like a real DAW.
          </h2>
        </div>
        <p className="max-w-[340px] text-[15px] leading-[1.5] text-studio-dim">
          From first pattern to shareable link — the full workflow lives in the browser.
        </p>
      </div>

      <ul className="mt-10 grid list-none grid-cols-3 gap-4 p-0 max-lg:grid-cols-2 max-md:grid-cols-1">
        {FEATURES.map((feature) => (
          <li
            key={feature.n}
            className="flex min-h-[200px] flex-col rounded-[14px] border border-studio-edge bg-studio-panel-2 p-7 transition-colors duration-150 hover:border-studio-edge-3"
          >
            <div className="font-mono text-xs text-studio-lime">{feature.n}</div>
            <h3 className="mt-[22px] text-xl font-semibold tracking-[-0.01em]">{feature.t}</h3>
            <p className="mt-2.5 text-[14.5px] leading-[1.55] text-studio-dim text-pretty">
              {feature.d}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CtaBand() {
  const { user } = useAuth();

  return (
    <section className={`${SHELL} mt-28 max-md:mt-16`}>
      <div className="relative overflow-hidden rounded-[20px] border border-studio-edge-2 bg-studio-panel-2 px-12 py-16 text-center max-md:px-6 max-md:py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 120% at 50% 0%, color-mix(in oklch, var(--color-studio-lime) 12%, transparent), transparent 70%)",
          }}
        />
        <div className="relative">
          <h2 className="text-[clamp(30px,3.8vw,46px)] font-bold tracking-[-0.03em] text-balance">
            {user ? "Back to the session." : "Start your first session."}
          </h2>
          <p className="mt-4 text-[17px] text-studio-muted">
            Open a link, invite your crew, hit play. That's the whole setup.
          </p>
          <div className="mt-[30px] flex flex-wrap justify-center gap-3.5">
            {user ? (
              <Cta to="/songs" size="lg">
                Open my songs
              </Cta>
            ) : (
              <>
                <Cta to="/register" size="lg">
                  Start a session
                </Cta>
                <GhostCta to="/login">Sign in</GhostCta>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className={`${SHELL} mt-[70px] flex flex-wrap items-center justify-between gap-4 border-t border-studio-edge py-10 pb-16`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <LiveDot size={10} blink={false} />
        <span className="font-bold">Cotune</span>
        <span className="ml-2 font-mono text-xs text-studio-dim">
          collaborative beats, in the browser
        </span>
      </div>
      {/* The mock had Docs, Status and Privacy here. None of them exist; the
          repository does. */}
      <a
        href="https://github.com/KhoaNguyen706/Cotune"
        target="_blank"
        rel="noreferrer"
        className="rounded text-[13px] text-studio-dim transition-colors hover:text-studio-lime focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
      >
        GitHub
      </a>
    </footer>
  );
}
