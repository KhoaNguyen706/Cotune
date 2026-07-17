import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card, Chip, Wordmark } from "../ui/kit";
import { BookIcon, ListIcon, ShieldIcon } from "../ui/icons";
import { AppShell, Canvas, NavItem, NavRail, Workspace } from "../ui/shell";

/**
 * The beat-making reference — what the numbers on the grid actually mean,
 * and which ones make music.
 *
 * WHERE THIS CONTENT COMES FROM: it is the same knowledge the server puts
 * in BeatComposer.SYSTEM_PROMPT and PatternGenerator.SYSTEM_PROMPT, plus
 * the hard bounds the domain enforces (Step's pitch format and velocity
 * range, Song's BPM limits, Beat.MAX_BARS). That is deliberate — the AI is
 * told these things, and you should be able to read what it was told —
 * but it is also a DUPLICATE, in TypeScript, of constants that live in
 * Java. Nothing makes them agree. If a bound changes server-side this page
 * quietly becomes wrong, so it states the RULES it is sure of and keeps
 * the taste (which BPM sounds sad) clearly marked as taste.
 *
 * A static page on purpose: no query, no props, no loading state. It is a
 * reference, and a reference that can fail to load is worse than a heading.
 */
export function HandbookPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <AppShell>
      <Workspace>
        <NavRail
          footer={
            <>
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-[13px] font-semibold text-accent">
                  {user?.displayName?.[0]?.toUpperCase() ?? "?"}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-bold">{user?.displayName}</span>
                  <span className="block font-mono text-[10.5px] text-muted">
                    {user?.role === "ADMIN" ? "Admin" : "Producer"}
                  </span>
                </span>
              </div>
              <button
                onClick={logout}
                className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-muted transition-colors hover:bg-surface-2/60 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Sign out
              </button>
            </>
          }
        >
          <div className="mb-4 px-1 py-2">
            <Wordmark />
          </div>

          <NavItem
            icon={<ListIcon className="h-[17px] w-[17px]" />}
            label="My songs"
            onClick={() => navigate("/songs")}
          />
          <NavItem icon={<BookIcon className="h-[17px] w-[17px]" />} label="Handbook" active />
          {user?.role === "ADMIN" && (
            <NavItem
              icon={<ShieldIcon className="h-[17px] w-[17px]" />}
              label="Admin"
              onClick={() => navigate("/admin")}
            />
          )}
        </NavRail>

        <Canvas className="p-8">
          <div className="mx-auto max-w-3xl">
            <div className="mb-8">
              <h1 className="text-3xl font-semibold tracking-[-0.02em]">Beat handbook</h1>
              <p className="mt-1 text-sm text-muted">
                What the grid's numbers mean, and which ones make music. This is also what the AI
                is told before it writes a pattern — so if a generated beat surprises you, the
                reason is probably on this page.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <Card>
                <h2 className="text-lg font-bold tracking-tight">The grid</h2>
                <p className="mt-1 text-sm text-muted">
                  One bar is <strong className="text-text">16 steps</strong> — sixteenth notes.
                  Steps are <strong className="text-text">0-based</strong>, so a one-bar beat runs
                  0&ndash;15 and there is no step 16. A beat can be 1 to 8 bars, which puts the
                  hard ceiling at 128 steps.
                </p>
                <p className="mt-3 text-sm text-muted">
                  In the text view a lane reads as{" "}
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-text">
                    x
                  </code>{" "}
                  for a hit,{" "}
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-text">
                    &mdash;
                  </code>{" "}
                  for a held note, and{" "}
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-text">
                    .
                  </code>{" "}
                  for silence.
                </p>
                <p className="mt-3 font-mono text-[12.5px] leading-relaxed text-muted">
                  kick&nbsp;&nbsp;x...x...x...x...
                  <br />
                  snare&nbsp;....x.......x...
                  <br />
                  bass&nbsp;&nbsp;x&mdash;&mdash;&mdash;....x&mdash;&mdash;&mdash;....
                </p>
              </Card>

              <Card>
                <h2 className="text-lg font-bold tracking-tight">Tempo carries the mood</h2>
                <p className="mt-1 text-sm text-muted">
                  Before you place a single note, the BPM has already decided how the beat feels.
                  These are the ranges the AI reaches for &mdash; conventions, not laws.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-edge text-muted">
                        <th className="pb-2 pr-4 font-semibold">Feel</th>
                        <th className="pb-2 pr-4 font-semibold">BPM</th>
                        <th className="pb-2 font-semibold">Reads as</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[13px]">
                      <tr className="border-b border-edge/50">
                        <td className="py-2 pr-4">Sad / lofi</td>
                        <td className="py-2 pr-4 text-accent">60&ndash;85</td>
                        <td className="py-2 font-sans text-muted">heavy, unhurried</td>
                      </tr>
                      <tr className="border-b border-edge/50">
                        <td className="py-2 pr-4">Hip-hop</td>
                        <td className="py-2 pr-4 text-accent">85&ndash;100</td>
                        <td className="py-2 font-sans text-muted">head-nod</td>
                      </tr>
                      <tr className="border-b border-edge/50">
                        <td className="py-2 pr-4">House</td>
                        <td className="py-2 pr-4 text-accent">120&ndash;128</td>
                        <td className="py-2 font-sans text-muted">driving, four-on-the-floor</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4">Drum &amp; bass</td>
                        <td className="py-2 pr-4 text-accent">170+</td>
                        <td className="py-2 font-sans text-muted">urgent, breakbeat</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-sm text-muted">
                  Cotune accepts <span className="font-mono text-text">20&ndash;400</span> BPM. The
                  range above is where music usually lives; the range Cotune allows is where
                  physics does.
                </p>
              </Card>

              <Card>
                <h2 className="text-lg font-bold tracking-tight">Where each instrument lives</h2>
                <p className="mt-1 text-sm text-muted">
                  Pitch is scientific notation &mdash; a letter{" "}
                  <span className="font-mono text-text">A&ndash;G</span>, an optional{" "}
                  <span className="font-mono text-text">#</span>, then an octave{" "}
                  <span className="font-mono text-text">0&ndash;8</span>. Same note, wrong octave,
                  is the most common way a pattern comes out sounding wrong.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-edge text-muted">
                        <th className="pb-2 pr-4 font-semibold">Part</th>
                        <th className="pb-2 pr-4 font-semibold">Octave</th>
                        <th className="pb-2 font-semibold">Why</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[13px]">
                      <tr className="border-b border-edge/50">
                        <td className="py-2 pr-4">Kick, snare</td>
                        <td className="py-2 pr-4 text-accent">near C2</td>
                        <td className="py-2 font-sans text-muted">
                          drums are pitched low; the grid slot matters more than the note
                        </td>
                      </tr>
                      <tr className="border-b border-edge/50">
                        <td className="py-2 pr-4">Bass</td>
                        <td className="py-2 pr-4 text-accent">C1&ndash;C3</td>
                        <td className="py-2 font-sans text-muted">
                          below the chords, or it fights them
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4">Chords, melody</td>
                        <td className="py-2 pr-4 text-accent">C4&ndash;C6</td>
                        <td className="py-2 font-sans text-muted">
                          where the ear hears "the tune"
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-sm text-muted">
                  Lanes available: <Chip>SYNTH</Chip> <Chip>PIANO</Chip> <Chip>DRUMS</Chip>{" "}
                  <Chip>BASS</Chip> <Chip>GUITAR</Chip> <Chip>STRINGS</Chip>
                </p>
              </Card>

              <Card>
                <h2 className="text-lg font-bold tracking-tight">Velocity and length</h2>
                <p className="mt-1 text-sm text-muted">
                  <strong className="text-text">Velocity</strong> is how hard the note is hit,
                  from just above <span className="font-mono">0</span> to{" "}
                  <span className="font-mono">1.0</span>. A pattern where every note is the same
                  velocity sounds like a machine, because it is one &mdash;{" "}
                  <strong className="text-text">accents are what make a groove</strong>. Put the
                  loud hits on the beat and ghost notes (0.1&ndash;0.3) just before it.
                </p>
                <p className="mt-3 text-sm text-muted">
                  <strong className="text-text">Length</strong> is measured in steps, not seconds,
                  so the arrangement survives a tempo change. Drums are almost always{" "}
                  <span className="font-mono text-text">1</span>. Held bass and pads are longer
                  &mdash; that is the difference between a plucked note and a chord that sits.
                </p>
              </Card>

              <Card>
                <h2 className="text-lg font-bold tracking-tight">What reads as sad, or human</h2>
                <p className="mt-1 text-sm text-muted">
                  The part that isn't arithmetic:
                </p>
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-muted marker:text-accent">
                  <li>
                    <strong className="text-text">Minor keys and space read as sad.</strong> Fewer
                    hits, further apart. Sadness is mostly what you leave out.
                  </li>
                  <li>
                    <strong className="text-text">Swing and ghost notes read as human.</strong>{" "}
                    Notes landing a touch late, quiet hits between the loud ones.
                  </li>
                  <li>
                    <strong className="text-text">Silence is a choice you are allowed to
                    make.</strong> An empty step is a decision, not an unfinished one.
                  </li>
                  <li>
                    <strong className="text-text">A beat is more than drums.</strong> Three to five
                    lanes is typical &mdash; drums, a bass, something harmonic.
                  </li>
                </ul>
              </Card>

              <Card>
                <h2 className="text-lg font-bold tracking-tight">Rules the server enforces</h2>
                <p className="mt-1 text-sm text-muted">
                  These aren't advice &mdash; a note breaking one of them is rejected, whether you
                  drew it or the AI proposed it.
                </p>
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-muted marker:text-accent">
                  <li>
                    Step must be <span className="font-mono text-text">0</span> or greater and fall
                    inside the beat's bars.
                  </li>
                  <li>
                    Pitch must match{" "}
                    <span className="font-mono text-text">A&ndash;G</span>, optional{" "}
                    <span className="font-mono text-text">#</span>, octave{" "}
                    <span className="font-mono text-text">0&ndash;8</span> &mdash;{" "}
                    <span className="font-mono text-text">C4</span>,{" "}
                    <span className="font-mono text-text">F#2</span>. There are no flats here:
                    write <span className="font-mono text-text">A#3</span>, not{" "}
                    <span className="font-mono text-text">Bb3</span>.
                  </li>
                  <li>
                    Velocity must be above <span className="font-mono text-text">0</span> and at
                    most <span className="font-mono text-text">1.0</span>. Zero isn't a quiet note,
                    it's no note.
                  </li>
                  <li>
                    A note must end before the beat does, and{" "}
                    <strong className="text-text">
                      two notes can't share one step and pitch
                    </strong>
                    .
                  </li>
                </ul>
              </Card>
            </div>
          </div>
        </Canvas>
      </Workspace>
    </AppShell>
  );
}
