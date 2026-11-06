const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
function unpackedExecutable(file) {
  // spawn() cannot execute a virtual ASAR path, even when its file is unpacked.
  // Use the real adjacent directory; keep development and override paths intact.
  const match = /^(.*[\\/])app\.asar([\\/].*)$/.exec(file);
  return match ? `${match[1]}app.asar.unpacked${match[2]}` : file;
}
const ffmpegPath = () => process.env.SLICETUNE_FFMPEG || unpackedExecutable(require('@ffmpeg-installer/ffmpeg').path);
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true });
    let error = '';
    child.stderr.on('data', data => { error = (error + data.toString()).slice(-8000); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('FFmpeg timeout (10 min)')); }, 600000);
    child.once('error', err => { clearTimeout(timeout); reject(err); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(error || `FFmpeg exit ${code}`)); });
  });
}
async function temporary(job) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'slicetune-'));
  try { return await job(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function decodeFile(input) {
  return temporary(async dir => {
    const output = path.join(dir, 'audio.wav');
    await runFfmpeg(['-i', input, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', output]);
    return (await readFile(output)).toString('base64');
  });
}
function tempoFilters(value) {
  const result = [];
  while (value < 0.5) { result.push('atempo=0.5'); value /= 0.5; }
  while (value > 2) { result.push('atempo=2'); value /= 2; }
  result.push(`atempo=${value}`);
  return result;
}
async function processAudio({ data, speed = 1, semitones = 0 }) {
  if (typeof data !== 'string' || data.length > 700000000 || !Number.isFinite(speed) || speed < 0.25 || speed > 4 || !Number.isFinite(semitones) || Math.abs(semitones) > 12) throw new Error('Invalid audio processing parameters');
  return temporary(async dir => {
    const input = path.join(dir, 'in.wav'), output = path.join(dir, 'out.wav');
    await writeFile(input, Buffer.from(data, 'base64'));
    const ratio = 2 ** (semitones / 12);
    const filters = semitones ? [`asetrate=${48000 * ratio}`, 'aresample=48000', ...tempoFilters(speed / ratio)] : tempoFilters(speed);
    await runFfmpeg(['-i', input, '-af', filters.join(','), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output]);
    return (await readFile(output)).toString('base64');
  });
}
async function encodeFile(data, output, format) {
  const codecs = { wav: ['-c:a', 'pcm_s24le'], mp3: ['-c:a', 'libmp3lame', '-b:a', '320k'], flac: ['-c:a', 'flac'], ogg: ['-c:a', 'libvorbis', '-q:a', '6'] };
  if (!codecs[format]) throw new Error('Unsupported export format');
  await temporary(async dir => {
    const input = path.join(dir, 'mix.wav');
    await writeFile(input, Buffer.from(data, 'base64'));
    await runFfmpeg(['-i', input, ...codecs[format], '-f', format === 'mp3' ? 'mp3' : format, output]);
  });
}
module.exports = { decodeFile, processAudio, encodeFile, tempoFilters, unpackedExecutable };
