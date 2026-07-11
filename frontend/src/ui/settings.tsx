import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * App settings: theme, auto-save, and the privacy switches.
 *
 * Persisted in localStorage rather than on the server, deliberately — these
 * are DEVICE preferences ("dark on my laptop, light on the studio monitor",
 * "don't keep me signed in on this shared machine"). Syncing them to the
 * account would actively break the last one: the whole point of "forget me
 * on this device" is that it applies to THIS device.
 */

export type Theme = "dark" | "light" | "system";

export interface Settings {
  theme: Theme;
  /** Save pattern edits automatically a moment after you stop editing. */
  autoSave: boolean;
  /** Keep the session token in localStorage (survives closing the browser)
   *  vs sessionStorage (dies with the tab). The honest phrasing of the
   *  classic "remember me" checkbox — see api/client.ts. */
  rememberDevice: boolean;
}

const DEFAULTS: Settings = {
  theme: "dark",
  autoSave: true,
  rememberDevice: true,
};

const STORAGE_KEY = "cotune.settings";

interface SettingsContextValue extends Settings {
  update(patch: Partial<Settings>): void;
  /** The theme actually in effect right now ("system" resolved). */
  resolvedTheme: "dark" | "light";
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Spread over DEFAULTS, never trust the stored shape: a settings key
    // added in a later release must not leave old clients with `undefined`.
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS; // corrupt JSON must not brick the app
  }
}

function systemTheme(): "dark" | "light" {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const [osTheme, setOsTheme] = useState<"dark" | "light">(systemTheme);

  // Follow the OS live while in "system" mode — the user flipping their
  // laptop to night mode should flip the app, without a reload.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setOsTheme(query.matches ? "light" : "dark");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = settings.theme === "system" ? osTheme : settings.theme;

  // ONE side effect owns the DOM attribute that every token in styles.css
  // keys off. Components never touch the theme; they just use tokens.
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  function update(patch: Partial<Settings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  return (
    <SettingsContext.Provider value={{ ...settings, resolvedTheme, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
