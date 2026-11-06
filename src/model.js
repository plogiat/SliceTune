export const COLORS = ['#ffb16e', '#f47d8b', '#d294ce', '#79c9c3', '#e9cb87', '#a2a3e5'];
export const uid = () => crypto.randomUUID();
export function newProject() { return { app: 'SliceTune', version: 1, name: 'Untitled', tracks: [], assets: {}, master: 0.85 }; }
export function newTrack(name, index = 0) { return { id: uid(), name, color: COLORS[index % COLORS.length], gain: 1, pan: 0, mute: false, solo: false, clips: [] }; }
export function newClip(assetId, duration, start = 0) { return { id: uid(), assetId, start, offset: 0, duration, gain: 1, fadeIn: 0, fadeOut: 0, reverse: false, low: 0, mid: 0, high: 0, compressor: false, reverb: 0, delay: 0 }; }
export function endTime(project) { return Math.max(0, ...project.tracks.flatMap(t => t.clips.map(c => c.start + c.duration))); }
export function splitClip(track, clipId, time) {
  const index = track.clips.findIndex(c => c.id === clipId), clip = track.clips[index];
  if (!clip || time <= clip.start + 0.01 || time >= clip.start + clip.duration - 0.01) return false;
  const left = time - clip.start, right = clip.duration - left;
  const second = { ...clip, id: uid(), start: time, duration: right, offset: clip.reverse ? clip.offset : clip.offset + left, fadeIn: 0, fadeOut: Math.min(clip.fadeOut, right) };
  if (clip.reverse) clip.offset += right;
  clip.duration = left; clip.fadeOut = 0; clip.fadeIn = Math.min(clip.fadeIn, left);
  track.clips.splice(index + 1, 0, second);
  return true;
}
export function trimClip(clip, edge, amount) {
  if (edge === 'left') {
    const delta = Math.max(clip.reverse ? 0 : -clip.offset, -clip.start, Math.min(clip.duration - 0.02, amount));
    clip.start += delta; clip.duration -= delta;
    if (!clip.reverse) clip.offset += delta;
  } else {
    // Right-edge dragging only shortens; source handles are intentionally bounded.
    const delta = Math.max(-clip.duration + 0.02, Math.min(0, amount));
    clip.duration += delta;
    if (clip.reverse) clip.offset -= delta;
  }
  clip.fadeIn = Math.min(clip.fadeIn, clip.duration); clip.fadeOut = Math.min(clip.fadeOut, clip.duration);
}
export function deleteRange(track, start, end) {
  const from = Math.min(start, end), to = Math.max(start, end);
  if (to - from < 0.001) return false;
  let changed = false;
  track.clips = track.clips.flatMap(clip => {
    const finish = clip.start + clip.duration;
    if (clip.start >= to || finish <= from) return [clip];
    changed = true;
    const pieces = [];
    const portion = (a, b) => ({ ...clip, id: uid(), start: a, duration: b - a,
      offset: clip.offset + (clip.reverse ? finish - b : a - clip.start),
      fadeIn: a === clip.start ? Math.min(clip.fadeIn, b - a) : 0,
      fadeOut: b === finish ? Math.min(clip.fadeOut, b - a) : 0 });
    if (from > clip.start) pieces.push(portion(clip.start, from));
    if (to < finish) pieces.push(portion(to, finish));
    return pieces;
  });
  return changed;
}
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validateProject(p) {
  if (!p || p.app !== 'SliceTune' || p.version !== 1 || typeof p.name !== 'string' || p.name.length > 200 || !Array.isArray(p.tracks) || p.tracks.length > 128 || !p.assets || typeof p.assets !== 'object' || Array.isArray(p.assets) || !finite(p.master, 0, 1.5)) throw new Error('Invalid SliceTune project');
  const ids = new Set();
  for (const [id, a] of Object.entries(p.assets)) {
    if (['__proto__', 'constructor', 'prototype'].includes(id) || !a || typeof a.name !== 'string' || typeof a.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) throw new Error('Invalid audio asset');
  }
  for (const t of p.tracks) {
    if (typeof t.id !== 'string' || ids.has(t.id) || typeof t.name !== 'string' || t.name.length > 200 || !/^#[0-9a-f]{6}$/i.test(t.color) || !finite(t.gain, 0, 2) || !finite(t.pan, -1, 1) || typeof t.mute !== 'boolean' || typeof t.solo !== 'boolean' || !Array.isArray(t.clips) || t.clips.length > 2000) throw new Error('Invalid track');
    ids.add(t.id);
    for (const c of t.clips) {
      if (typeof c.id !== 'string' || ids.has(c.id) || !Object.hasOwn(p.assets, c.assetId) || !finite(c.start, 0, 86400) || !finite(c.offset, 0, 86400) || !finite(c.duration, 0.001, 86400) || !finite(c.gain, 0, 2) || !finite(c.fadeIn, 0, c.duration) || !finite(c.fadeOut, 0, c.duration) || !finite(c.low, -18, 18) || !finite(c.mid, -18, 18) || !finite(c.high, -18, 18) || !finite(c.reverb, 0, 1) || !finite(c.delay, 0, 1) || typeof c.reverse !== 'boolean' || typeof c.compressor !== 'boolean') throw new Error('Invalid clip');
      ids.add(c.id);
    }
  }
  return p;
}
export class History {
  constructor(limit = 60) { this.limit = limit; this.past = []; this.future = []; }
  snapshot(project) { const { assets, ...edit } = project; return structuredClone(edit); }
  push(project) { this.past.push(this.snapshot(project)); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(project) { if (!this.past.length) return project; this.future.push(this.snapshot(project)); return { ...this.past.pop(), assets: project.assets }; }
  redo(project) { if (!this.future.length) return project; this.past.push(this.snapshot(project)); return { ...this.future.pop(), assets: project.assets }; }
}
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer); let result = '';
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
}
export function fromBase64(data) { const text = atob(data); return Uint8Array.from(text, c => c.charCodeAt(0)).buffer; }
export function encodeWav(channels, sampleRate) {
  const length = channels[0].length, count = channels.length;
  const data = new ArrayBuffer(44 + length * count * 2), view = new DataView(data);
  const str = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, length * count * 2, true);
  for (let i = 0; i < length; i++) for (let c = 0; c < count; c++) { const x = Math.max(-1, Math.min(1, channels[c][i])); view.setInt16(44 + (i * count + c) * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true); }
  return data;
}
