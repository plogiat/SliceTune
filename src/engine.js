import { endTime, encodeWav, fromBase64 } from './model.js';
export class AudioEngine {
  constructor() { this.buffers = new Map(); this.nodes = []; this.started = 0; this.offset = 0; this.playing = false; }
  get context() { return this.ctx ||= new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }); }
  async decode(data) { return this.context.decodeAudioData(fromBase64(data)); }
  slice(clip) {
    const source = this.buffers.get(clip.assetId);
    if (!source) throw new Error('Audio asset is missing');
    const from = Math.round(clip.offset * source.sampleRate), length = Math.min(Math.round(clip.duration * source.sampleRate), source.length - from);
    if (length < 1) throw new Error('Clip is outside source audio');
    const result = this.context.createBuffer(source.numberOfChannels, length, source.sampleRate);
    for (let c = 0; c < source.numberOfChannels; c++) {
      const channel = source.getChannelData(c).slice(from, from + length);
      if (clip.reverse) channel.reverse();
      result.copyToChannel(channel, c);
    }
    return result;
  }
  wav(buffer) { return encodeWav(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), buffer.sampleRate); }
  impulse(ctx) {
    const length = ctx.sampleRate * 1.8, result = ctx.createBuffer(2, length, ctx.sampleRate);
    let seed = 42;
    for (let c = 0; c < 2; c++) { const x = result.getChannelData(c); for (let i = 0; i < length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; x[i] = (seed / 2147483648 - 1) * (1 - i / length) ** 3; } }
    return result;
  }
  schedule(ctx, project, position = 0, destination = ctx.destination) {
    const master = ctx.createGain(); master.gain.value = project.master;
    // A final limiter protects ears and exports against overlapping clip peaks.
    const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    master.connect(limiter).connect(destination);
    const solo = project.tracks.some(t => t.solo), sources = [], now = ctx.currentTime;
    for (const track of project.tracks) {
      if (track.mute || (solo && !track.solo)) continue;
      const level = ctx.createGain(), pan = ctx.createStereoPanner(); level.gain.value = track.gain; pan.pan.value = track.pan; level.connect(pan).connect(master);
      for (const clip of track.clips) {
        if (clip.start + clip.duration <= position) continue;
        const source = ctx.createBufferSource(); source.buffer = this.slice(clip);
        const local = Math.max(0, position - clip.start), at = now + Math.max(0, clip.start - position), remaining = Math.min(clip.duration, source.buffer.duration) - local;
        if (remaining <= 0) continue;
        const gain = ctx.createGain(); source.connect(gain);
        const envelope = time => clip.gain * Math.min(1, clip.fadeIn ? time / clip.fadeIn : 1, clip.fadeOut ? (clip.duration - time) / clip.fadeOut : 1);
        gain.gain.setValueAtTime(Math.max(0, envelope(local)), at);
        const points = [clip.fadeIn, clip.duration - clip.fadeOut, clip.duration].filter(t => t > local).sort((a, b) => a - b);
        for (const point of points) gain.gain.linearRampToValueAtTime(Math.max(0, envelope(point)), at + point - local);
        let tail = gain;
        for (const [type, freq, value] of [['lowshelf', 200, clip.low], ['peaking', 1200, clip.mid], ['highshelf', 5000, clip.high]]) {
          const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.gain.value = value; filter.Q.value = 0.7; tail.connect(filter); tail = filter;
        }
        if (clip.compressor) { const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 4; comp.knee.value = 20; tail.connect(comp); tail = comp; }
        tail.connect(level);
        if (clip.reverb > 0) { const reverb = ctx.createConvolver(), wet = ctx.createGain(); reverb.buffer = this.impulse(ctx); wet.gain.value = clip.reverb; tail.connect(reverb).connect(wet).connect(level); }
        if (clip.delay > 0) { const delay = ctx.createDelay(1), wet = ctx.createGain(), feedback = ctx.createGain(); delay.delayTime.value = 0.28; wet.gain.value = clip.delay; feedback.gain.value = 0.32; tail.connect(delay).connect(wet).connect(level); delay.connect(feedback).connect(delay); }
        source.start(at, local, remaining); sources.push(source);
      }
    }
    return { sources, master, limiter };
  }
  async play(project, position) {
    this.stop(); await this.context.resume();
    const graph = this.schedule(this.context, project, position);
    this.nodes = graph.sources; this.masterNode = graph.master; this.limiterNode = graph.limiter;
    this.started = this.context.currentTime; this.offset = position; this.playing = true;
  }
  position() { return this.playing ? this.offset + this.context.currentTime - this.started : this.offset; }
  stop() { const position = this.position(); for (const node of this.nodes) { try { node.stop(); } catch {} } this.nodes = []; this.masterNode?.disconnect(); this.limiterNode?.disconnect(); this.playing = false; this.offset = position; return position; }
  async render(project) {
    const duration = endTime(project) + 3;
    if (duration > 1800) throw new Error('Export limit: 30 minutes');
    const context = new OfflineAudioContext(2, Math.ceil(Math.max(0.1, duration) * 48000), 48000);
    this.schedule(context, project); return context.startRendering();
  }
}
