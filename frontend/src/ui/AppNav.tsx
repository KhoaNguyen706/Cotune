import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Wordmark } from "./kit";
import { BookIcon, ListIcon, ShareIcon, ShieldIcon, SignOutIcon, SlidersIcon } from "./icons";
import { NavItem, NavRail } from "./shell";
import { SettingsModal } from "./SettingsModal";

const ICON = "h-[17px] w-[17px]";

/**
 * The app's one navigation rail, for every signed-in page outside the editor.
 *
 * It used to be three hand-copied rails (songs, handbook, admin) that had
 * already drifted: different items on each page, and a different label under
 * your name on each ("Free plan", "Producer", "Admin"). One component means
 * one set of destinations.
 *
 * The active item is derived from the URL, not passed in, so it can't
 * disagree with where you are. That is also why "Shared with me" is a URL
 * (/songs?view=shared) rather than page state: the handbook can link to it,
 * and Back walks out of it.
 */
export function AppNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const onSongs = pathname === "/songs";
  const sharedView = onSongs && params.get("view") === "shared";

  return (
    <>
      <NavRail
        footer={
          <>
            {/* Who you are, as facts the server holds: name and email. */}
            <div className="flex items-center gap-3 rounded-lg border border-edge p-2 max-md:border-0 max-md:p-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[13px] font-semibold text-text">
                {user?.displayName?.trim()?.[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="min-w-0 leading-tight max-md:hidden">
                <span className="block truncate text-sm font-semibold">{user?.displayName}</span>
                <span className="block truncate text-xs text-muted">{user?.email}</span>
              </span>
            </div>
            <NavItem icon={<SignOutIcon className={ICON} />} label="Sign out" onClick={logout} />
          </>
        }
      >
        <div className="mb-4 px-1 py-2">
          <Wordmark compactOnPhone />
        </div>
        <NavItem
          icon={<ListIcon className={ICON} />}
          label="My songs"
          active={onSongs && !sharedView}
          onClick={() => navigate("/songs")}
        />
        <NavItem
          icon={<ShareIcon className={ICON} />}
          label="Shared with me"
          active={sharedView}
          onClick={() => navigate("/songs?view=shared")}
        />
        <NavItem
          icon={<BookIcon className={ICON} />}
          label="Handbook"
          active={pathname === "/handbook"}
          onClick={() => navigate("/handbook")}
        />
        {/* Affordance only — /admin and its mutations are gated server-side. */}
        {user?.role === "ADMIN" && (
          <NavItem
            icon={<ShieldIcon className={ICON} />}
            label="Admin"
            active={pathname === "/admin"}
            onClick={() => navigate("/admin")}
          />
        )}
        <NavItem icon={<SlidersIcon className={ICON} />} label="Settings" onClick={() => setSettingsOpen(true)} />
      </NavRail>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
