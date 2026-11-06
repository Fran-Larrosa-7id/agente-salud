// Shared by the browser observer and the direct X11 sampler. Synthetic pixels only.
export function decodeMarker(rgbAt) {
  const words = [];
  for (const offset of [0, 88, 176]) {
    let word = 0;
    for (let bit = 0; bit < 12; bit++) {
      const rgb = rgbAt(offset + bit * 6 + 3, 4);
      const luminance = (rgb[0] + rgb[1] + rgb[2]) / 3;
      if (luminance > 96 && luminance < 160) return null;
      if (luminance >= 160) word |= 1 << bit;
    }
    words.push(word);
  }
  return words[0] === words[1] && (words[0] ^ words[2]) === 4095 ? words[0] : null;
}

export function observationSummary(samples) {
  let previous = null, lastChange = null, changes = 0, backwards = 0, invalid = 0, duplicates = 0, gaps = 0;
  const intervals = [];
  for (const { at, id } of samples) {
    if (id === null) { invalid++; continue; }
    if (previous !== null) {
      const delta = (id - previous + 4096) % 4096;
      if (delta === 0) { duplicates++; continue; }
      if (delta >= 2048) { backwards++; continue; }
      changes++; gaps += delta - 1;
      if (lastChange !== null) intervals.push(at - lastChange);
      lastChange = at;
    } else lastChange = at;
    previous = id;
  }
  const elapsedMs = samples.length > 1 ? samples.at(-1).at - samples[0].at : 0;
  intervals.sort((a, b) => a - b);
  const p = fraction => intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))] : null;
  return { samples: samples.length, elapsedMs, changes, changesPerSecond: elapsedMs > 0 ? changes * 1000 / elapsedMs : null,
    invalidMarkers: invalid, backwards, duplicates, unobservedSequenceNumbers: gaps,
    intervalMs: { p50: p(.5), p95: p(.95), p99: p(.99), max: intervals.at(-1) ?? null } };
}

export function rawMarkerSamples(buffer, at) {
  // ffmpeg crops 264 x 12 RGB24. Its input still reads the full framebuffer.
  return { at, id: decodeMarker((x, y) => buffer.subarray((y * 264 + x) * 3, (y * 264 + x) * 3 + 3)) };
}
