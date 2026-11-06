import { SoundTouch, SimpleFilter } from 'soundtouchjs';
export function detectPitch(samples, sampleRate) {
  let energy = 0; for (const x of samples) energy += x * x;
  if (Math.sqrt(energy / samples.length) < 0.008) return null;
  // Normalized squared difference (YIN), with parabolic period refinement.
  const min = Math.floor(sampleRate / 1000), max = Math.min(Math.floor(sampleRate / 65), Math.floor(samples.length / 2));
  const difference = new Float64Array(max + 1); let sum = 0;
  for (let lag = 1; lag <= max; lag++) {
    let error = 0; for (let i = 0; i < samples.length - max; i++) error += (samples[i] - samples[i + lag]) ** 2;
    sum += error; difference[lag] = sum ? error * lag / sum : 1;
    if (lag > min + 1 && difference[lag - 1] < 0.15 && difference[lag] > difference[lag - 1]) {
      const p = lag - 1, left = difference[p - 1], mid = difference[p], right = difference[p + 1], denominator = 2 * (left - 2 * mid + right);
      const refined = p + (denominator ? (left - right) / denominator : 0);
      return sampleRate / refined;
    }
  }
  return null;
}
export function targetMidi(midi, root, mode) {
  const scale = mode === 'chromatic' ? [0,1,2,3,4,5,6,7,8,9,10,11] : mode === 'major' ? [0,2,4,5,7,9,11] : [0,2,3,5,7,8,10];
  let best = Math.round(midi), distance = Infinity;
  for (let note = Math.floor(midi) - 12; note <= Math.ceil(midi) + 12; note++) if (scale.includes(((note - root) % 12 + 12) % 12) && Math.abs(note - midi) < distance) { best = note; distance = Math.abs(note - midi); }
  return best;
}
export async function correctPitch(buffer, context, root, mode, amount, progress = () => {}) {
  const sr = buffer.sampleRate, length = buffer.length;
  const input = new Float32Array(length * 2);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
  for (let i = 0; i < length; i++) { input[2 * i] = left[i]; input[2 * i + 1] = right[i]; }
  if (amount === 0) return buffer;
  const st = new SoundTouch();
  st.stretch.setParameters(sr, 0, 0, 8);
  let lastPosition = 0, ratio = 1;
  const filter = new SimpleFilter({ extract(target, frames, position) {
    // Flush SoundTouch's look-ahead with silence so short clips and final
    // syllables are processed rather than silently dropping the last block.
    const available = Math.min(frames, length + 32768 - position);
    if (available <= 0) return 0;
    const start = Math.max(0, Math.min(length - 2048, position));
    const pitch = detectPitch(left.subarray(start, start + 2048), sr);
    if (pitch) { const midi = 69 + 12 * Math.log2(pitch / 440); const wanted = 2 ** ((targetMidi(midi, root, mode) - midi) * amount / 12); ratio = ratio * 0.2 + wanted * 0.8; }
    else ratio = ratio * 0.7 + 0.3;
    st.pitch = ratio;
    target.fill(0);
    if (position < length) target.set(input.subarray(position * 2, Math.min(length, position + available) * 2));
    lastPosition = position; return available;
  } }, st);
  const chunks = []; let total = 0, cycles = 0;
  while (true) {
    const block = new Float32Array(8192); const frames = filter.extract(block, 4096);
    if (!frames) break; chunks.push(block.slice(0, frames * 2)); total += frames;
    if (total >= length) break;
    if (++cycles % 10 === 0) { progress(Math.min(99, Math.round(lastPosition / length * 100))); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  const result = context.createBuffer(2, length, sr);
  // SoundTouch has short boundary latency; preserve the exact clip duration.
  let offset = 0;
  for (const chunk of chunks) { for (let i = 0; i < chunk.length / 2 && offset + i < length; i++) { result.getChannelData(0)[offset + i] = chunk[i * 2]; result.getChannelData(1)[offset + i] = chunk[i * 2 + 1]; } offset += chunk.length / 2; }
  if (!total) throw new Error('Pitch correction produced no audio');
  return result;
}
