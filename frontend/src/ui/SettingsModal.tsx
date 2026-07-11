import { setRememberDevice } from "../api/client";
import { useSettings, type Theme } from "./settings";
import { Modal } from "./shell";

/**
 * Settings. Three sections, each one honest about what it actually does —
 * a privacy panel that lists controls the app doesn't really honor is worse
 * than no privacy panel at all.
 */

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A real switch, not a checkbox: role + aria-checked so it announces
 *  correctly, and the whole pill is the hit target. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-150 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
        (checked ? "bg-accent" : "bg-surface-2 border border-edge")
      }
    >
      <span
        className={
          "absolute top-0.5 h-5 w-5 rounded-full bg-bg shadow transition-[left] duration-150 " +
          (checked ? "left-[22px]" : "left-0.5")
        }
      />
    </button>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="flex flex-col">
        <h3 className="mb-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">
          Appearance
        </h3>
        <Row title="Theme" hint="System follows your OS light/dark setting.">
          <div className="flex gap-0.5 rounded-lg border border-edge bg-bg-soft p-0.5">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                onClick={() => settings.update({ theme: theme.value })}
                className={
                  "cursor-pointer rounded-md px-3 py-1 text-xs font-semibold transition-colors duration-150 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
                  (settings.theme === theme.value
                    ? "bg-surface-2 text-text"
                    : "text-muted hover:text-text")
                }
              >
                {theme.label}
              </button>
            ))}
          </div>
        </Row>

        <hr className="my-2 border-edge" />
        <h3 className="mb-1 mt-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">
          Editor
        </h3>
        <Row
          title="Auto-save"
          hint="Saves your pattern edits a second after you stop editing. Turn it off to save manually with the Save button."
        >
          <Toggle
            label="Auto-save"
            checked={settings.autoSave}
            onChange={(autoSave) => settings.update({ autoSave })}
          />
        </Row>

        <hr className="my-2 border-edge" />
        <h3 className="mb-1 mt-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">
          Privacy
        </h3>
        <Row
          title="Stay signed in on this device"
          hint="On: your session is kept until it expires. Off: it is dropped the moment you close the tab — use this on a shared computer."
        >
          <Toggle
            label="Stay signed in on this device"
            checked={settings.rememberDevice}
            onChange={(rememberDevice) => {
              settings.update({ rememberDevice });
              // The storage layer owns WHERE the token lives; flipping the
              // switch migrates the live session immediately rather than at
              // next login (api/client.ts).
              setRememberDevice(rememberDevice);
            }}
          />
        </Row>

        {/* Statements, not switches: these describe what the app does. It
            would be easy — and dishonest — to render a "disable analytics"
            toggle here when there is no analytics to disable. */}
        <ul className="mt-2 flex list-none flex-col gap-1.5 rounded-lg border border-edge bg-bg-soft p-3 text-xs leading-relaxed text-muted">
          <li>· Your songs are private to your account. Nobody else can open them.</li>
          <li>· No analytics, no tracking scripts, no third-party cookies.</li>
          <li>· Uploaded audio is stored on the Cotune server and never shared.</li>
          <li>· Your password is stored only as a bcrypt hash — it can't be read back.</li>
        </ul>
      </div>
    </Modal>
  );
}
