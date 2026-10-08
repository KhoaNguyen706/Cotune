import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Tone from "tone";
import { ApiError, gql } from "../api/client";
import {
  arrangementEndSeconds,
  prefetchBuffers,
  scheduleArrangement,
  secondsPerStep,
  type ArrangementSources,
} from "../audio/engine";
import { fxBusFor } from "../audio/fx";
import { createInstrument, type TrackInstrument } from "../audio/instruments";
import { Card, Chip, ErrorBanner, Skeleton, Spinner, Wordmark } from "../ui/kit";
import { PlayIcon, StopIcon } from "../ui/icons";
import type { ListenSong, Step } from "../types";

/**
 * The public player: no account, no editor, one button. The token in the
 * URL is the whole authorization — the page asks the public `listen`
 * query and streams audio from the public bytes route, both of which the
 * server refuses the moment the owner turns the link off.
 */

const LISTEN_QUERY = `
  query Listen($token: String!) {
    listen(token: $token) {
      title bpm timeSignature
      beats {
        id name position bars swing
        tracks { id name instrument position volume pan reverb delay pattern { step pitch velocity length } }
      }
      clips { id lane startStep lengthSteps type beatId audioId }
      audioFiles { id contentType durationSeconds }
    }
  }
`;

/**
 * What to play: the arrangement if there is one; otherwise LOOP the first
 * beat that has notes. Half of shared songs are beat sketches with an
 * empty timeline, and "the link plays silence" would read as broken —
 * the fallback makes every shareable song audible.
 */
function buildSources(song: ListenSong): { sources: ArrangementSources; loopSeconds: number | null } {
  const patterns: Record<string, Step[]> = {};
  for (const beat of song.beats) {
    for (const lane of beat.tracks) patterns[lane.id] = lane.pattern;
  }
  if (song.clips.length > 0) {
    return {
      sources: { bpm: song.bpm, clips: song.clips, beats: song.beats, patterns },
      loopSeconds: null,
    };
  }
  const beat = song.beats.find((b) => b.tracks.some((t) => t.pattern.length > 0));
  if (!beat) {
    return { sources: { bpm: song.bpm, clips: [], beats: [], patterns }, loopSeconds: null };
  }
  const lengthSteps = beat.bars * 16;
  return {
    // A synthetic clip is all it takes — the scheduler doesn't care that
    // the placement never existed in the database.
    sources: {
      bpm: song.bpm,
      clips: [{ lane: 0, startStep: 0, lengthSteps, type: "BEAT", beatId: beat.id }],
      beats: song.beats,
      patterns,
    },
    loopSeconds: lengthSteps * secondsPerStep(song.bpm),
  };
}

export function ListenPage() {
  const { token = "" } = useParams();
  const [song, setSong] = useState<ListenSong | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [starting, setStarting] = useState(false);

  const instrumentsRef = useRef<Map<string, TrackInstrument>>(new Map());
  const playersRef = useRef<Tone.Player[]>([]);

  useEffect(() => {
    let cancelled = false;
    gql<{ listen: ListenSong }>(LISTEN_QUERY, { token })
      .then((data) => {
        if (!cancelled) setSong(data.listen);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This listen link doesn't exist — or its owner turned it off."
            : "Couldn't load this song. Try again in a moment.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Tone lives outside React and will happily keep playing a closed page
  // (usePlayback's lesson, relearned nowhere).
  useEffect(() => {
    const instruments = instrumentsRef;
    const players = playersRef;
    return () => {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      transport.loop = false;
      for (const player of players.current) {
        player.unsync();
        player.dispose();
      }
      players.current = [];
      instruments.current.forEach((i) => i.dispose());
      instruments.current.clear();
    };
  }, []);

  const playable = useMemo(() => {
    if (!song) return false;
    const { sources, loopSeconds } = buildSources(song);
    return (loopSeconds ?? arrangementEndSeconds(sources)) > 0;
  }, [song]);

  function stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.loop = false;
    for (const player of playersRef.current) {
      player.unsync();
      player.dispose();
    }
    playersRef.current = [];
    setPlaying(false);
    setProgress(0);
  }

  async function togglePlay() {
    if (!song || starting) return;
    if (playing) {
      stop();
      return;
    }
    setStarting(true);
    try {
      const { sources, loopSeconds } = buildSources(song);
      const end = loopSeconds ?? arrangementEndSeconds(sources);
      if (end === 0) return;

      await Tone.start();
      const transport = Tone.getTransport();
      transport.bpm.value = sources.bpm;
      fxBusFor().setTempo(sources.bpm);

      for (const beat of song.beats) {
        for (const lane of beat.tracks) {
          if (!instrumentsRef.current.has(lane.id)) {
            instrumentsRef.current.set(
              lane.id,
              createInstrument(lane.instrument, {
                volume: lane.volume,
                pan: lane.pan,
                reverb: lane.reverb,
                delay: lane.delay,
              }),
            );
          }
        }
      }
      // Audio bytes come from the PUBLIC route — the whole page runs
      // without a session.
      const buffers = await prefetchBuffers(
        sources.clips,
        (audioId) => `/api/listen/${token}/audio/${audioId}`,
      );
      playersRef.current = scheduleArrangement({
        sources,
        instruments: instrumentsRef.current,
        buffers,
      });

      const perStep = secondsPerStep(sources.bpm);
      const totalSteps = Math.max(1, Math.round(end / perStep));
      let step = 0;
      transport.scheduleRepeat((time) => {
        const current = step++ % totalSteps;
        Tone.getDraw().schedule(() => setProgress((current + 1) / totalSteps), time);
      }, perStep, 0);

      if (loopSeconds !== null) {
        // Beat-sketch mode loops until the listener stops it.
        transport.loop = true;
        transport.setLoopPoints(0, loopSeconds);
      } else {
        transport.schedule((time) => {
          Tone.getDraw().schedule(() => stop(), time);
        }, end + 0.1);
      }
      transport.start();
      setPlaying(true);
    } finally {
      setStarting(false);
    }
  }

  const lanes = song ? song.beats.reduce((n, b) => n + b.tracks.length, 0) : 0;

  return (
    <main className="page-center flex-col">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mb-6 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-lg"
        >
          <Wordmark size="lg" />
        </Link>

        <Card>
          {error ? (
            <ErrorBanner>{error}</ErrorBanner>
          ) : !song ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              <p className="text-[0.8125rem] font-semibold text-muted">
                Shared song
              </p>
              <h1 className="mt-1 truncate text-2xl font-extrabold tracking-tight">{song.title}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip>{song.bpm} BPM</Chip>
                <Chip>{song.timeSignature}</Chip>
                {lanes > 0 && <Chip>{lanes} {lanes === 1 ? "lane" : "lanes"}</Chip>}
              </div>

              <div className="mt-6 flex items-center gap-4">
                <button
                  onClick={() => void togglePlay()}
                  disabled={!playable || starting}
                  aria-label={playing ? "Stop" : "Play"}
                  className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-bg transition-[filter] duration-150 hover:not-disabled:brightness-110 disabled:cursor-default disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {starting ? (
                    <Spinner className="h-5 w-5" />
                  ) : playing ? (
                    <StopIcon className="h-5 w-5" />
                  ) : (
                    <PlayIcon className="h-5 w-5" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-bg-soft">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-150"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  {!playable && <p className="mt-2 text-xs text-muted">This song has no notes yet.</p>}
                </div>
              </div>
            </>
          )}
        </Card>

        <p className="mt-4 text-center text-sm text-muted">
          Made with Cotune.{" "}
          <Link
            className="font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            to="/register"
          >
            Make your own
          </Link>
        </p>
      </div>
    </main>
  );
}
