import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, gql } from "../api/client";
import { colorFor } from "../ui/trackColors";
import type { Song } from "../types";

// Queries live next to the component that owns them; each asks for exactly
// the fields this screen renders — that per-view field selection is the
// actual point of GraphQL (no over-fetching, no v2-endpoint-per-screen).
const SONGS_QUERY = `
  query Songs {
    songs {
      id title bpm timeSignature ownerId version createdAt
      tracks { id name instrument position }
    }
  }
`;

const CREATE_SONG = `
  mutation CreateSong($input: CreateSongInput!) {
    createSong(input: $input) { id }
  }
`;

const DELETE_SONG = `
  mutation DeleteSong($id: ID!) {
    deleteSong(id: $id)
  }
`;

export function SongsPage() {
  const { user, logout } = useAuth();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [bpm, setBpm] = useState(120);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await gql<{ songs: Song[] }>(SONGS_QUERY);
      setSongs(data.songs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load songs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await gql(CREATE_SONG, { input: { title, bpm, timeSignature } });
      setTitle("");
      // Re-query instead of hand-patching local state: one source of truth
      // (the server), and we automatically see songs other collaborators
      // created — a habit that matters once real-time editing arrives.
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create song");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await gql(DELETE_SONG, { id });
      await refresh();
    } catch (e) {
      // Shouldn't normally happen (the button only renders for the owner),
      // but the SERVER is the enforcement — this catch is for devtools
      // adventurers and stale pages.
      setError(e instanceof ApiError && e.status === 403
        ? "Only the song's creator can delete it"
        : "Failed to delete song");
    }
  }

  return (
    <main className="wide">
      <header className="topbar">
        <h1 className="brand-text">Cotune</h1>
        <div className="user-chip">
          <span className="avatar">{user?.displayName?.[0]?.toUpperCase() ?? "?"}</span>
          <span className="who">{user?.displayName}</span>
          <button className="ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <section className="card">
        <h2>New song</h2>
        <form onSubmit={onCreate} className="row">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
          </label>
          <label>
            BPM
            <input
              type="number"
              min={20}
              max={400}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Time signature
            <input
              value={timeSignature}
              onChange={(e) => setTimeSignature(e.target.value)}
              required
              pattern="\d{1,2}/\d{1,2}"
              title="e.g. 4/4"
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Songs</h2>
        {loading ? (
          <p>Loading…</p>
        ) : songs.length === 0 ? (
          <p>No songs yet — create the first one above.</p>
        ) : (
          <ul className="songs">
            {songs.map((song) => (
              <li key={song.id} className="card song-card">
                <div className="song-head">
                  <strong>{song.title}</strong>
                  <span className="chips">
                    <span className="chip">{song.bpm} BPM</span>
                    <span className="chip">{song.timeSignature}</span>
                    {song.ownerId === user?.id && <span className="chip mine">yours</span>}
                  </span>
                  <Link className="open" to={`/songs/${song.id}`}>
                    Open →
                  </Link>
                  {/* UI mirrors the server rule (owner-only) for honest
                      affordances; the real gate is @PreAuthorize server-side. */}
                  {song.ownerId === user?.id && (
                    <button className="danger" onClick={() => void onDelete(song.id)}>
                      Delete
                    </button>
                  )}
                </div>
                {song.tracks.length > 0 && (
                  <div className="pills">
                    {[...song.tracks]
                      // The API contract says: sort by position, never
                      // assume contiguity (gaps appear after deletes).
                      .sort((a, b) => a.position - b.position)
                      .map((track) => (
                        <span
                          key={track.id}
                          className="pill"
                          style={{ "--tc": colorFor(track.instrument) } as React.CSSProperties}
                        >
                          <i />
                          {track.name}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
