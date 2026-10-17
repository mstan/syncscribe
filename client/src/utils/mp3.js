/**
 * MPEG audio (Layer III) helpers for the audio UploadDropzone extracts.
 *
 * Duration is measured from the MP3 bytes themselves (the exact bytes that are
 * hashed and uploaded) by walking frame headers, rather than trusting the
 * input container's "Duration:" log line, which describes the source file and
 * may differ from the extracted track (or be N/A).
 */

// Layer III bitrates (kbps) by bitrate index. Index 0 = free format, 15 = invalid.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

// Sample rates by version bits (0 = MPEG 2.5, 2 = MPEG 2, 3 = MPEG 1).
const SAMPLE_RATES = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

/**
 * Parse a Layer III frame header at offset i. Returns null if not a valid header.
 */
function parseFrameHeader(bytes, i) {
  if (i + 4 > bytes.length) return null;
  const b1 = bytes[i + 1];
  const b2 = bytes[i + 2];
  if (bytes[i] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0x03; // 1 = reserved
  const layer = (b1 >> 1) & 0x03; // 1 = Layer III
  const bitrateIdx = b2 >> 4;
  const srIdx = (b2 >> 2) & 0x03;
  if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null;

  const isV1 = version === 3;
  const bitrate = (isV1 ? BITRATES_V1 : BITRATES_V2)[bitrateIdx] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  const padding = (b2 >> 1) & 0x01;
  const mono = (bytes[i + 3] >> 6) === 3;

  return {
    isV1,
    mono,
    sampleRate,
    samples: isV1 ? 1152 : 576,
    length: Math.floor(((isV1 ? 144 : 72) * bitrate) / sampleRate) + padding,
  };
}

/**
 * If the frame at offset i is a Xing/Info header frame (LAME and ffmpeg write
 * one as the first frame), return its gapless info: { delay, padding } in
 * samples from the LAME tag (0 if absent). Returns null for an audio frame.
 * The Xing frame itself carries no audio, so it isn't counted.
 */
function readXingFrame(bytes, i, header) {
  const sideInfo = header.isV1 ? (header.mono ? 17 : 32) : (header.mono ? 9 : 17);
  const x = i + 4 + sideInfo;
  if (x + 8 > bytes.length) return null;
  const tag = String.fromCharCode(bytes[x], bytes[x + 1], bytes[x + 2], bytes[x + 3]);
  if (tag !== 'Xing' && tag !== 'Info') return null;

  // Skip the optional Xing fields (frames, bytes, TOC, quality) per the flags.
  const flags = bytes[x + 7];
  let p = x + 8;
  if (flags & 0x1) p += 4;
  if (flags & 0x2) p += 4;
  if (flags & 0x4) p += 100;
  if (flags & 0x8) p += 4;

  // LAME tag: 9-byte encoder string, then the 12-bit delay / 12-bit padding at +21.
  // Same encoder-string check as ffmpeg's mp3 demuxer ("LAME", "Lavf", "Lavc").
  if (p + 24 > bytes.length) return { delay: 0, padding: 0 };
  const encoder = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
  if (encoder !== 'LAME' && encoder !== 'Lavf' && encoder !== 'Lavc') return { delay: 0, padding: 0 };
  return {
    delay: (bytes[p + 21] << 4) | (bytes[p + 22] >> 4),
    padding: ((bytes[p + 22] & 0x0f) << 8) | bytes[p + 23],
  };
}

/**
 * Size of a leading ID3v2 tag (header + body + optional footer), or 0.
 */
function id3v2Size(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const hasFooter = (bytes[5] & 0x10) !== 0;
  return 10 + size + (hasFooter ? 10 : 0);
}

/**
 * True if offset i starts a trailing 128-byte ID3v1 tag ("TAG").
 */
function isId3v1At(bytes, i) {
  return i + 128 === bytes.length && bytes[i] === 0x54 && bytes[i + 1] === 0x41 && bytes[i + 2] === 0x47;
}

/**
 * Duration of an MP3 in seconds (float): audio frames counted one by one, less
 * the encoder delay/padding recorded in the LAME tag, i.e. the length of the
 * original audio (the same gapless duration ffmpeg reports when decoding).
 * Returns null if no audio frames are found.
 *
 * A candidate header is only accepted if the next frame (or the end of the
 * data, or a trailing ID3v1 tag) starts where it predicts, so stray 0xFFE bit
 * patterns in junk between frames don't count.
 */
export function mp3DurationSeconds(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // Integer sample counts per sample rate; divide once at the end so float
  // accumulation can't nudge an exact duration over an integer (which a
  // caller's Math.ceil would then round up).
  const samplesByRate = new Map();
  let gapless = null; // { delay, padding, sampleRate } from a leading Xing/LAME frame
  let i = id3v2Size(bytes);
  let first = true;

  while (i + 4 <= bytes.length) {
    const header = parseFrameHeader(bytes, i);
    const end = header ? i + header.length : 0;
    const confirmed = header && (
      end >= bytes.length || isId3v1At(bytes, end) || parseFrameHeader(bytes, end) !== null
    );
    if (!confirmed) {
      i++; // resync
      continue;
    }

    const xing = first ? readXingFrame(bytes, i, header) : null;
    if (xing) {
      gapless = { ...xing, sampleRate: header.sampleRate };
    } else {
      samplesByRate.set(header.sampleRate, (samplesByRate.get(header.sampleRate) || 0) + header.samples);
    }
    first = false;
    i = end;
  }

  if (samplesByRate.size === 0) return null;
  if (gapless && samplesByRate.has(gapless.sampleRate)) {
    const trimmed = samplesByRate.get(gapless.sampleRate) - gapless.delay - gapless.padding;
    samplesByRate.set(gapless.sampleRate, Math.max(0, trimmed));
  }
  let seconds = 0;
  for (const [rate, samples] of samplesByRate) seconds += samples / rate;
  return seconds > 0 ? seconds : null;
}

/**
 * The exact bytes a Uint8Array views, as a standalone ArrayBuffer. A view can
 * sit inside a larger buffer; hashing/uploading `.buffer` would then include
 * bytes outside it.
 */
export function exactArrayBuffer(view) {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) return view.buffer;
  return view.slice().buffer;
}
