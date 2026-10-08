import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Wordmark, buttonClass } from "../ui/kit";
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
 * THE DESIGN RULE: the product is the picture. The shot below is the real
 * editor, captured by e2e/landing-shot.mjs with two accounts in one session,
 * so the collaborator's cursor in it is a real cursor. The page claims
 * nothing the screenshot can't back up.
 *
 * Built from the same Chassis tokens as the app, and it follows the theme
 * like every other screen: the front door should look like the room you are
 * about to walk into. Outside AppShell because a landing page is a DOCUMENT
 * that scrolls, and #root is a non-scrolling workstation, so this opts into
 * its own scroll container.
 */
export function HomePage() {
  return (
    <div className="h-full overflow-y-auto bg-bg text-text">
      <Nav />
      <Hero />
      <Features />
      <Footer />
    </div>
  );
}

const SHELL = "mx-auto w-full max-w-[1120px] px-8 max-md:px-4";

const textLink =
  "whitespace-nowrap rounded-sm px-2 py-1 text-sm font-semibold text-muted transition-colors duration-150 hover:text-text " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function Nav() {
  const { user } = useAuth();
  return (
    <nav className={`${SHELL} flex items-center justify-between gap-4 py-6`}>
      <Link to="/" aria-label="Cotune home" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Wordmark />
      </Link>
      {user ? (
        <Link to="/songs" className={buttonClass()}>
          Open my songs
        </Link>
      ) : (
        <div className="flex items-center gap-2">
          <Link to="/login" className={textLink}>
            Sign in
          </Link>
          {/* Not on a phone: there is no room for both, and the same key
              sits right below in the hero. */}
          <Link to="/register" className={`${buttonClass()} max-sm:hidden`}>
            Create account
          </Link>
        </div>
      )}
    </nav>
  );
}

function Hero() {
  const { user } = useAuth();
  return (
    <header className={`${SHELL} pb-16 pt-14 max-md:pt-6`}>
      {/* The one bold thing on the page: the headline set wide and heavy,
          the way a model name is printed on a machine. */}
      <h1 className="max-w-[820px] text-[clamp(32px,5.2vw,60px)] font-extrabold leading-[1.02] tracking-[-0.02em] text-balance font-stretch-expanded">
        Make beats together, in the browser.
      </h1>
      <p className="mt-6 max-w-[560px] text-lg leading-[1.55] text-muted text-pretty max-md:text-base">
        Cotune is a pattern sequencer where everyone on a song edits the same grid at the same
        time: notes, mix and arrangement. Nothing to install.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {user ? (
          <Link to="/songs" className={buttonClass()}>
            Open my songs
          </Link>
        ) : (
          <>
            <Link to="/register" className={buttonClass()}>
              Create account
            </Link>
            <Link to="/login" className={buttonClass("ghost")}>
              Sign in
            </Link>
          </>
        )}
      </div>

      {/* The screen set into the faceplate: a panel with the shot inset. */}
      <figure className="mt-14 rounded-xl border border-edge bg-surface p-2 max-md:mt-10">
        <img
          src={editorShot}
          width={1600}
          height={1000}
          alt="The Cotune beat editor: the beat tabs, a piano roll with a keys part under the beat-colored step ruler, a second collaborator's cursor on the grid, and the mixer with one channel strip per lane."
          className="w-full rounded-lg border border-edge"
        />
        <figcaption className="px-2 pb-1 pt-3 text-sm text-muted">
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
      <h2 className="text-2xl font-extrabold tracking-[-0.01em] font-stretch-semi-expanded">What's in it</h2>
      <dl className="mt-8 grid grid-cols-3 gap-x-10 max-lg:grid-cols-2 max-md:grid-cols-1">
        {FEATURES.map((feature) => (
          <div key={feature.t} className="border-t border-edge-strong py-6">
            <dt className="font-bold">{feature.t}</dt>
            <dd className="mt-2 text-[15px] leading-[1.55] text-muted text-pretty">{feature.d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Footer() {
  return (
    <footer className={`${SHELL} flex flex-wrap items-center justify-between gap-4 border-t border-edge-strong py-8`}>
      <Wordmark />
      {/* The repository is the one footer link that exists. */}
      <a href="https://github.com/KhoaNguyen706/Cotune" target="_blank" rel="noreferrer" className={textLink}>
        GitHub
      </a>
    </footer>
  );
}
