/**
 * The instruments a lane can be, in ONE place so every picker agrees — the
 * beat browser's "add lane" dropdown and the arrangement's "add instrument"
 * list were about to keep separate copies, which is how they drift.
 *
 * Order here is the order they're offered. The strings are the backend
 * `Instrument` enum values (schema.graphqls); a lane stores one of these and
 * `createInstrument` (audio/instruments.ts) turns it into sound.
 */
export const INSTRUMENTS = ["DRUMS", "BASS", "SYNTH", "PIANO", "GUITAR", "STRINGS"] as const;

/** Display name for an instrument enum value — "PIANO" → "Piano". Kept out of
 *  the components so a future rename (or diacritic name) changes one line. */
export function instrumentLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
