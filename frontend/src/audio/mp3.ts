import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * AudioBuffer → MP3 blob, encoded in the browser (lamejs — the LAME
 * encoder transpiled to JS). Client-side keeps export serverless, same
 * reasoning as the WAV path; the cost is ~1s of CPU per minute of audio,
 * paid by the one machine that wants the file.
 */
export function encodeMp3(buffer: AudioBuffer, kbps = 192): Blob {
  // MP3 is mono or stereo; fold anything wider down to its first two
  // channels (our renders are stereo anyway).
  const channels = Math.min(buffer.numberOfChannels, 2) as 1 | 2;
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);

  const left = toInt16(buffer.getChannelData(0));
  const right = channels === 2 ? toInt16(buffer.getChannelData(1)) : undefined;

  const chunks: Uint8Array[] = [];
  // 1152 samples = one MPEG1 frame — the encoder's natural block size.
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const encoded = right
      ? encoder.encodeBuffer(l, right.subarray(i, i + block))
      : encoder.encodeBuffer(l);
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));

  return new Blob(chunks, { type: "audio/mpeg" });
}

/** Float [-1,1] → int16, clamped so overs saturate instead of wrapping
 *  (same rule as encodeWav in engine.ts). */
function toInt16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}
