import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import editorShot from "../assets/editor-session.jpg";

/**
 * The PUBLIC front door. Until this existed, / redirected straight to
 * /login: a stranger's first frame was a password prompt for a product
 * they had never heard of, and the only honest response to that is to
 * close the tab.
 *
 * EVERYONE sees it, signed in or out (see App.tsx) — it is the front door,
 * not a thing you get redirected past. What changes when you are signed in
 * is only the calls to action: a person who already has an account does not
 * need to be sold, they need the way in.
 *
 * THE DESIGN RULE, after a pass that stripped the template out of it: the
 * product is the picture. The hero used to be a hand-drawn sequencer MOCK
 * with glowing cells and floating cursor tags, next to a pill eyebrow, a
 * headline with one lime word, and a "Live / ∞ / 0 / FL-style" stats strip
 * — every one of them a stock landing-page move. The shot below is the real
 * editor, captured with two accounts in one session, so the collaborator's
 * cursor in it is a real cursor. The page claims nothing the screenshot
 * can't back up.
 *
 * It keeps its own fixed-dark "studio" palette (see styles.css): it is a
 * poster, so it does not follow the theme toggle. Outside AppShell for the
 * same reason: a landing page is a DOCUMENT that scrolls, and #root is a
 * non-scrolling workstation, so this opts into its own scroll container.
 */
export function HomePage() {
  return (
    <div className="h-full overflow-y-auto bg-studio-bg text-studio-text antialiased">
      <Nav />
      <Hero />
      <Features />
      <Footer />
    </div>
  );
}

const SHELL = "mx-auto w-full max-w-[1120px] px-8 max-md:px-5";

/** Primary call to action. An <a>, because every one of these navigates —
 *  a <button> that routes is a link wearing a costume. */
function Cta({ to, children, ghost }: { to: string; children: React.ReactNode; ghost?: boolean }) {
  return (
    <Link
      to={to}
      className={
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-[filter,border-color,color] duration-150 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime focus-visible:ring-offset-2 focus-visible:ring-offset-studio-bg " +
        (ghost
          ? "border border-studio-edge-3 text-studio-text hover:border-studio-text"
          : "bg-studio-lime text-studio-bg hover:brightness-110")
      }
    >
      {children}
    </Link>
  );
}

function Mark() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-studio-lime" />
      <span className="text-lg font-bold tracking-[-0.01em]">Cotune</span>
    </span>
  );
}

function Nav() {
  const { user } = useAuth();
  return (
    <nav className={`${SHELL} flex items-center justify-between gap-6 py-6`}>
      <Link
        to="/"
        aria-label="Cotune home"
        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
      >
        <Mark />
      </Link>
      {user ? (
        <Cta to="/songs">Open my songs</Cta>
      ) : (
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded px-2 py-1 text-sm text-studio-muted transition-colors hover:text-studio-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
          >
            Sign in
          </Link>
          <Cta to="/register">Create account</Cta>
        </div>
      )}
    </nav>
  );
}

function Hero() {
  const { user } = useAuth();
  return (
    <header className={`${SHELL} pb-16 pt-16 max-md:pt-8`}>
      <h1 className="max-w-[760px] text-[clamp(34px,5.4vw,58px)] font-bold leading-[1.02] tracking-[-0.03em] text-balance">
        Make beats together, in the browser.
      </h1>
      <p className="mt-5 max-w-[560px] text-lg leading-[1.55] text-studio-muted text-pretty max-md:text-base">
        Cotune is a pattern sequencer where everyone on a song edits the same grid at the same
        time: notes, mix and arrangement. Nothing to install.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {user ? (
          <Cta to="/songs">Open my songs</Cta>
        ) : (
          <>
            <Cta to="/register">Create account</Cta>
            <Cta to="/login" ghost>
              Sign in
            </Cta>
          </>
        )}
      </div>

      <figure className="mt-14 max-md:mt-10">
        <img
          src={editorShot}
          width={1600}
          height={1000}
          alt="The Cotune beat editor: a piano roll with a drum pattern, the channel rack below it, and a second collaborator's cursor on the grid."
          className="w-full rounded-lg border border-studio-edge-2"
        />
        <figcaption className="mt-3 font-mono text-xs text-studio-dim">
          Two accounts in one song. The labelled box on the grid is the other person's cursor.
        </figcaption>
      </figure>
    </header>
  );
}

/** Each line describes something shipped and checked against the code. A
 *  landing page that promises a feature the app doesn't have is a bug
 *  report scheduled for later. */
const FEATURES = [
  {
    t: "Live editing",
    d: "Each note travels as its own operation, so two people in one lane merge instead of overwriting each other. You see where everyone is working.",
  },
  {
    t: "Patterns and arrangement",
    d: "Build beats from instrument lanes in a piano roll, then arrange them on a timeline alongside your own audio.",
  },
  {
    t: "Groove and mix",
    d: "Swing per beat, velocity per note, and volume, pan, reverb and delay on every lane, saved with the song.",
  },
  {
    t: "History",
    d: "Every edit is recorded with who made it. Restore a lane to any earlier point.",
  },
  {
    t: "Sharing",
    d: "Invite editors or viewers, or publish a read-only link that plays without an account.",
  },
  {
    t: "Export",
    d: "Render the arrangement to WAV or MP3, in the browser, with the mix and effects you hear.",
  },
];

function Features() {
  return (
    <section className={`${SHELL} pb-20`}>
      <h2 className="text-2xl font-bold tracking-[-0.02em]">What's in it</h2>
      <dl className="mt-8 grid grid-cols-3 gap-x-10 max-lg:grid-cols-2 max-md:grid-cols-1">
        {FEATURES.map((feature) => (
          <div key={feature.t} className="border-t border-studio-edge py-6">
            <dt className="font-semibold">{feature.t}</dt>
            <dd className="mt-2 text-[15px] leading-[1.55] text-studio-muted text-pretty">{feature.d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Footer() {
  return (
    <footer className={`${SHELL} flex flex-wrap items-center justify-between gap-4 border-t border-studio-edge py-8`}>
      <Mark />
      {/* The repository is the one footer link that exists. */}
      <a
        href="https://github.com/KhoaNguyen706/Cotune"
        target="_blank"
        rel="noreferrer"
        className="rounded text-sm text-studio-dim transition-colors hover:text-studio-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-lime"
      >
        GitHub
      </a>
    </footer>
  );
}
