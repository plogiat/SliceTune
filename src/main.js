import './style.css';
import { createIcons, icons } from 'lucide';
import { newProject, newTrack, newClip, uid, endTime, splitClip, trimClip, History, toBase64, validateProject } from './model.js';
import { AudioEngine } from './engine.js';
import { correctPitch } from './autotune.js';
import { translator } from './i18n.js';

const app = document.querySelector('#app'), engine = new AudioEngine();
let language = localStorage.getItem('slicetune-language') === 'en' ? 'en' : 'ru', t = translator(language);
let project = newProject(); project.name = t('untitled');
let history = new History(), selected = null, position = 0, zoom = 32, dirty = false, busy = false, clipboard = null, mixerVisible = true, modal = null, recorder = null, recordingStream = null, recordingStart = 0, recordingWallStart = 0, micId = '', devices = [], recovery = null, autosaveTimer = null, saveRevision = 0, autosaved = false;
const desktop = window.desktop;
let renameTrackId = null, micPending = false, micProblem = 'micDenied';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const button = (action, name, label, extra = '') => `<button data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`;
const time = value => `${String(Math.floor(value / 60)).padStart(2,'0')}:${(value % 60).toFixed(3).padStart(6,'0')}`;
const db = value => value <= 0 ? '−∞' : `${(20 * Math.log10(value)).toFixed(1)}`;
function chosen() { const track = project.tracks.find(t => t.id === selected?.trackId); return { track, clip: track?.clips.find(c => c.id === selected?.clipId) }; }
function toast(message, error = false) { const box = document.querySelector('#toast'); box.textContent = message; box.className = `toast show ${error ? 'error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 5000); }
function stop(keep = true) { position = keep ? engine.stop() : (engine.stop(), 0); }
function beforeEdit() { if (engine.playing) stop(); history.push(project); }
function changed() { dirty = true; autosaved = false; saveRevision++; render(); scheduleAutosave(); }
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (!desktop || recorder) return;
  const revision = saveRevision;
  autosaveTimer = setTimeout(async () => { try { await desktop.autosave(serialize()); if (revision === saveRevision) { autosaved = true; updateStatus(); } } catch (err) { toast(`${t('error')}: ${err.message}`, true); } }, 1800);
}
function serialize() {
  // Include the library as well: non-destructive processing keeps every source.
  const data = JSON.stringify(project);
  if (data.length > 512 * 1024 * 1024) throw new Error(t('memoryLimit'));
  return data;
}
async function task(job) {
  if (busy || recorder) { toast(t('busy')); return; }
  busy = true; stop(); render();
  let failure;
  try { await job(); } catch (err) { console.error(err); failure = err; }
  finally { busy = false; render(); }
  // render() replaces the toast node. Report failures after the final render.
  if (failure) toast(`${t('error')}: ${failure.message}`, true);
}
function slider(name, value, min, max, step, label, suffix = '', attributes = '') {
  return `<label class="control"><span>${esc(label)}<output>${esc(value)}${suffix}</output></span><input aria-label="${esc(label)}" type="range" data-param="${name}" min="${min}" max="${max}" step="${step}" value="${value}" ${attributes}></label>`;
}
function render() {
  const scroll = document.querySelector('#timeline'); const oldScroll = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : { left: 0, top: 0 };
  const { track, clip } = chosen(), duration = Math.max(30, Math.ceil((endTime(project) + 8) / 5) * 5), width = Math.max(760, duration * zoom);
  document.documentElement.lang = language;
  app.innerHTML = `
  <header class="topbar"><div class="brand">${icon('audio-lines')}<strong>Slice<span>Tune</span></strong><span class="badge">PREVIEW</span></div>
    <div class="project-title"><input id="project-name" aria-label="${t('projectName')}" value="${esc(project.name)}" maxlength="200"><span id="save-status"></span></div>
    <nav class="project-actions">${button('new','file-plus-2',t('new'))}${button('open','folder-open',t('open'))}${button('save','save',t('save')+' · Ctrl+S')}</nav>
    <div class="language" role="group" aria-label="${t('language')}"><button data-action="ru" aria-pressed="${language === 'ru'}">RU</button><button data-action="en" aria-pressed="${language === 'en'}">EN</button></div>
    <button class="primary export-button" data-action="export">${icon('upload')}${t('export')}</button>
  </header>
  <section class="transport"><div class="transport-controls">${button('record','mic',recorder ? t('recording') : t('record'),`class="record ${recorder ? 'active' : ''}"`)}${button('play',engine.playing ? 'pause' : 'play',engine.playing ? t('pause') : t('play'),'class="play"')}${button('stop','square',t('stop'))}</div>
    <div class="timecode" id="timecode">${time(position)}</div><span class="transport-separator"></span>
    <div class="session-info"><span class="session-dot ${recorder ? 'recording' : ''}"></span><span>${recorder ? t('recording') : t('ready')}</span><small>48 kHz / 24-bit export</small></div>
    <div class="transport-right"><span class="small-label">${t('mic')}</span><select id="mic-device" aria-label="${t('mic')}" ${recorder ? 'disabled' : ''}><option value="">${t('defaultMic')}</option>${devices.map(d => `<option value="${esc(d.deviceId)}" ${micId === d.deviceId ? 'selected' : ''}>${esc(d.label || t('mic'))}</option>`).join('')}</select>${button('devices','refresh-cw',t('refresh'))}${button('help','circle-help',t('help'))}</div>
  </section>
  ${recovery ? `<div class="recovery">${icon('history')} ${t('recovering')} <button data-action="recover">${t('recover')}</button><button data-action="dismiss">${t('dismiss')}</button></div>` : ''}
  <main class="workspace">
    <aside class="library"><div class="panel-title"><span>${icon('folder-open')}${t('files')}</span><small>${Object.keys(project.assets).length}</small></div><button class="import-button" data-action="import">${icon('plus')}${t('import')}<small>${t('importHint')}</small></button>
    <div class="asset-list">${Object.entries(project.assets).map(([id, a]) => `<div class="asset" draggable="true" data-asset="${esc(id)}" title="${esc(a.name)}">${icon('file-audio')}<span>${esc(a.name)}<small>${engine.buffers.get(id)?.duration.toFixed(1) || ''} ${t('seconds')}</small></span><button data-action="add-asset" data-id="${esc(id)}" aria-label="${t('addTrack')}">${icon('plus')}</button></div>`).join('') || `<div class="library-empty">${icon('files')}<p>${t('emptyFiles')}</p></div>`}</div>
    <button class="demo-button" data-action="demo">${icon('sparkles')}${t('demo')}</button><div class="library-bottom"><div class="sunset-orb"></div><span>MAKE WAVES.<br>MAKE IT YOURS.</span><small>SliceTune / Tokyo Sunset</small></div></aside>
    <section class="editor"><div class="edit-toolbar"><div class="tool-group">${button('undo','undo-2',t('undo'),' '+(!history.past.length ? 'disabled' : ''))}${button('redo','redo-2',t('redo'),' '+(!history.future.length ? 'disabled' : ''))}</div><span class="divider"></span><div class="tool-group">${button('split','scissors',t('split')+' · S',!clip ? 'disabled' : '')}${button('copy','copy',t('copy'),!clip ? 'disabled' : '')}${button('paste','clipboard-paste',t('paste'),!clipboard ? 'disabled' : '')}${button('delete','trash-2',t('remove'),!clip ? 'disabled' : '')}</div><button class="text-button join-button" data-action="join" title="${t('joinHint')}" ${!track?.clips.length ? 'disabled' : ''}>${icon('combine')}${t('join')}</button><div class="zoom">${icon('zoom-out')}<input id="zoom" aria-label="${t('zoom')}" type="range" min="12" max="100" value="${zoom}">${icon('zoom-in')}</div></div>
      <div class="timeline" id="timeline"><div class="timeline-inner" style="width:${width + 178}px"><div class="ruler-row"><div class="track-ruler">${icon('headphones')} ${t('project')}</div><div class="ruler" data-ruler style="width:${width}px">${Array.from({ length: Math.ceil(width / (zoom * (zoom < 24 ? 10 : 5))) + 1 }, (_, i) => { const second = i * (zoom < 24 ? 10 : 5); return `<span style="left:${second * zoom}px">${second} ${t('seconds')}</span>`; }).join('')}</div></div>
      ${project.tracks.map((tr, index) => `<div class="track-row ${track?.id === tr.id ? 'selected-track' : ''}" data-track="${tr.id}"><div class="track-header" style="--track-color:${tr.color}"><div class="track-top"><span class="track-number">${String(index + 1).padStart(2,'0')}</span><button class="track-name" data-action="rename-track" data-id="${tr.id}" title="${t('rename')}">${esc(tr.name)}</button><button class="track-delete" data-action="delete-track" data-id="${tr.id}" aria-label="${t('deleteTrack')}">${icon('x')}</button></div><div class="track-switches"><button data-action="mute" data-id="${tr.id}" class="${tr.mute ? 'on' : ''}" title="${t('mute')}" aria-label="${t('mute')} ${esc(tr.name)}" aria-pressed="${tr.mute}">M</button><button data-action="solo" data-id="${tr.id}" class="${tr.solo ? 'on' : ''}" title="${t('solo')}" aria-label="${t('solo')} ${esc(tr.name)}" aria-pressed="${tr.solo}">S</button><span>${db(tr.gain)} dB</span></div><input type="range" aria-label="${t('volume')} ${esc(tr.name)}" data-track-gain="${tr.id}" min="0" max="2" step="0.01" value="${tr.gain}"></div><div class="track-lane" data-lane="${tr.id}" style="width:${width}px;--grid:${zoom * (zoom < 24 ? 10 : 5)}px">${tr.clips.map(c => `<div tabindex="0" role="button" aria-label="${esc(project.assets[c.assetId]?.name)}" class="clip ${c.id === clip?.id ? 'selected' : ''}" data-clip="${c.id}" style="left:${c.start * zoom}px;width:${Math.max(8, c.duration * zoom)}px;--clip-color:${tr.color}"><div class="clip-label">${c.reverse ? '↶ ' : ''}${esc(project.assets[c.assetId]?.name)}</div><canvas data-wave="${c.id}"></canvas><div class="fade-indicator in" style="width:${Math.min(c.duration, c.fadeIn) * zoom}px"></div><div class="fade-indicator out" style="width:${Math.min(c.duration, c.fadeOut) * zoom}px"></div><div class="trim-handle left" data-edge="left" title="${t('trim')}"></div><div class="trim-handle right" data-edge="right" title="${t('trim')}"></div></div>`).join('')}</div></div>`).join('')}
      ${!project.tracks.length ? `<div class="empty-session"><div class="empty-symbol">${icon('audio-lines')}</div><span class="eyebrow">YOUR NEXT GREAT SOUND</span><h1>${t('emptyTitle')}</h1><p>${t('emptyText')}</p><div><button class="primary" data-action="import">${icon('plus')}${t('import')}</button><button class="secondary" data-action="record">${icon('mic')}${t('record')}</button></div><button class="text-button" data-action="demo">${t('demo')} ${icon('arrow-up-right')}</button></div>` : ''}
      <div class="add-track-row"><button data-action="add-track">${icon('plus')}${t('addTrack')}</button></div><div id="playhead" class="playhead" style="left:${178 + position * zoom}px"><span></span></div></div></div>
      <section class="mixer ${mixerVisible ? '' : 'collapsed'}"><div class="mixer-heading"><button data-action="mixer">${icon('sliders-horizontal')}${t('mixer')}${icon(mixerVisible ? 'chevron-down' : 'chevron-up')}</button><span>${t('limiter')}</span></div>${mixerVisible ? `<div class="mixer-channels">${project.tracks.map(tr => `<div class="channel" style="--track-color:${tr.color}"><div class="channel-title">${icon('audio-lines')}<span>${esc(tr.name)}</span></div><div class="channel-level"><input aria-label="${t('volume')} ${esc(tr.name)}" type="range" data-track-gain="${tr.id}" min="0" max="2" step="0.01" value="${tr.gain}"><output>${db(tr.gain)} dB</output></div><label class="pan-label">L <input aria-label="${t('pan')} ${esc(tr.name)}" data-track-pan="${tr.id}" type="range" min="-1" max="1" step="0.05" value="${tr.pan}"> R</label></div>`).join('')}<div class="channel master"><div class="channel-title">${icon('volume-2')}<span>${t('master')}</span></div><div class="channel-level"><input id="master" aria-label="${t('master')}" type="range" min="0" max="1.5" step="0.01" value="${project.master}"><output>${db(project.master)} dB</output></div><span class="master-label">STEREO OUT · LIMITER</span></div></div>` : ''}</section>
    </section>
    <aside class="inspector"><div class="panel-title"><span>${icon('sliders-horizontal')}${t('effects')}</span></div>${clip ? inspector(clip, track) : `<div class="inspector-empty">${icon('mouse-pointer-2')}<h3>${t('selected')}</h3><p>${t('selectHint')}</p></div><div class="effect-preview"><span>01 / SHAPE</span><h3>${t('eq')}</h3><div class="eq-art"></div><span>02 / SPACE</span><h3>${t('reverb')} + ${t('delay')}</h3><div class="rings"></div></div>`}</aside>
  </main><footer class="statusbar"><span>${icon('audio-lines')} ${t('version')}</span><span>${project.tracks.length} ${t('tracks')} · ${Object.keys(project.assets).length} ${t('assets')}</span><span>${t('duration')}: ${time(endTime(project))}</span><span class="footer-right">${desktop ? 'LOCAL AUDIO / NO CLOUD' : t('browserHint')}</span></footer><div id="modal-root"></div><div id="toast" class="toast" role="status" aria-live="polite"></div>${busy ? `<div class="busy-overlay"><div class="spinner"></div><strong id="busy-label">${t('processing')}</strong></div>` : ''}`;
  createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
  const timeline = document.querySelector('#timeline'); timeline.scrollLeft = oldScroll.left; timeline.scrollTop = oldScroll.top;
  updateStatus(); requestAnimationFrame(drawWaves);
  if (modal) renderModal();
}
function inspector(c, tr) {
  return `<div class="inspector-body"><div class="selected-card" style="--track-color:${tr.color}">${icon('audio-waveform')}<div><small>${t('selectedLabel')}</small><strong>${esc(project.assets[c.assetId]?.name)}</strong><span>${c.duration.toFixed(2)} ${t('seconds')}</span></div></div>
    <section class="effect-section">${slider('gain',c.gain,0,2,0.01,t('volume'),'×')}${slider('fadeIn',c.fadeIn,0,Math.min(c.duration,10),0.01,t('fadeIn'),' '+t('seconds'))}${slider('fadeOut',c.fadeOut,0,Math.min(c.duration,10),0.01,t('fadeOut'),' '+t('seconds'))}<label class="toggle-row">${t('reverse')}<input type="checkbox" data-param="reverse" ${c.reverse ? 'checked' : ''} role="switch"></label></section>
    <details class="effect-card" open><summary>${icon('chart-no-axes-combined')}${t('eq')}${icon('chevron-down')}</summary><div>${slider('low',c.low,-18,18,1,t('low'),' dB')}${slider('mid',c.mid,-18,18,1,t('mid'),' dB')}${slider('high',c.high,-18,18,1,t('high'),' dB')}</div></details>
    <div class="effect-card compact"><label class="toggle-row">${icon('list-filter')}${t('compressor')}<input type="checkbox" data-param="compressor" ${c.compressor ? 'checked' : ''} role="switch"></label></div>
    <details class="effect-card"><summary>${icon('orbit')}${t('reverb')} / ${t('delay')}${icon('chevron-down')}</summary><div>${slider('reverb',c.reverb,0,1,0.01,t('reverb'))}${slider('delay',c.delay,0,1,0.01,t('delay'))}</div></details>
    <details class="effect-card"><summary>${icon('gauge')}${t('transform')}${icon('chevron-down')}</summary><div><label class="select-label">${t('speed')}<select id="speed">${[0.25,0.5,0.75,1,1.25,1.5,2,3,4].map(v => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v}×</option>`).join('')}</select></label><label class="select-label">${t('pitch')}<select id="pitch">${Array.from({length:25},(_,i) => i-12).map(v => `<option value="${v}" ${!v ? 'selected' : ''}>${v > 0 ? '+' : ''}${v}</option>`).join('')}</select></label><button class="secondary full" data-action="transform">${t('apply')}</button></div></details>
    <details class="effect-card tune-card"><summary>${icon('sparkles')}${t('tune')}${icon('chevron-down')}</summary><div><span class="beta-label">${t('experimental')}</span><label class="select-label">${t('root')}<select id="tune-root">${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'].map((v,i) => `<option value="${i}">${v}</option>`).join('')}</select></label><label class="select-label">${t('scale')}<select id="tune-scale"><option value="minor">${t('minor')}</option><option value="major">${t('major')}</option><option value="chromatic">${t('chromatic')}</option></select></label><label class="control"><span>${t('amount')}<output>80%</output></span><input aria-label="${t('amount')}" id="tune-amount" type="range" min="0" max="100" value="80"></label><p class="effect-hint">${t('tuneHint')}</p><button class="primary full" data-action="tune">${icon('sparkles')}${t('apply')}</button></div></details></div>`;
}
function updateStatus() { const node = document.querySelector('#save-status'); if (node) node.textContent = !dirty ? `○ ${t('saved')}` : autosaved ? `● ${t('autosaved')}` : `● ${t('unsaved')}`; }
function drawWaves() {
  for (const canvas of document.querySelectorAll('canvas[data-wave]')) {
    const id = canvas.dataset.wave, track = project.tracks.find(tr => tr.clips.some(c => c.id === id)), clip = track?.clips.find(c => c.id === id), buffer = engine.buffers.get(clip?.assetId);
    if (!buffer) continue;
    const width = Math.min(12000, Math.max(1, Math.round(canvas.clientWidth))), height = 58, ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.fillStyle = track.color;
    const data = buffer.getChannelData(0), offset = Math.floor(clip.offset * buffer.sampleRate), length = Math.min(Math.floor(clip.duration * buffer.sampleRate), data.length - offset);
    for (let x = 0; x < width; x += 2) {
      const from = Math.floor(x / width * length), to = Math.max(from + 1, Math.floor((x + 2) / width * length)); let peak = 0;
      const stride = Math.max(1, Math.floor((to - from) / 60));
      for (let i = from; i < to; i += stride) { const index = clip.reverse ? offset + length - 1 - i : offset + i; peak = Math.max(peak, Math.abs(data[index] || 0)); }
      const h = Math.max(1, Math.min(height, peak * height * clip.gain)); ctx.fillRect(x, (height - h) / 2, 1.5, h);
    }
  }
}
function renderModal() {
  const root = document.querySelector('#modal-root');
  const rename = project.tracks.find(tr => tr.id === renameTrackId);
  const contents = modal === 'microphone' ? `<h2>${t('micProblem')}</h2><p>${t(micProblem)}</p>${micProblem === 'micDenied' ? `<p>${t(desktop?.platform === 'win32' ? 'micWindowsHelp' : 'micPermissionHelp')}</p>` : ''}<div class="modal-actions"><button class="secondary" data-action="close-modal">${t('close')}</button>${micProblem === 'micDenied' && desktop?.platform === 'win32' ? `<button class="secondary" data-action="mic-settings">${t('micSettings')}</button>` : ''}<button class="primary" data-action="retry-record">${t('retry')}</button></div>` : modal === 'rename-track' ? `<h2>${t('rename')}</h2><label class="select-label">${t('renamePrompt')}<input id="rename-value" maxlength="200" value="${esc(rename?.name)}"></label><div class="modal-actions"><button class="secondary" data-action="close-modal">${t('cancel')}</button><button class="primary" data-action="do-rename">${t('apply')}</button></div>` : modal === 'export' ? `<h2>${t('exportTitle')}</h2><p>${t('exportHint')}</p><label class="select-label">${t('format')}<select id="export-format">${(desktop ? ['wav','mp3','flac','ogg'] : ['wav']).map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('')}</select></label><label class="select-label">${t('scope')}<select id="export-scope"><option value="mix">${t('mix')}</option>${chosen().track ? `<option value="track">${t('selectedTrack')}</option>` : ''}${chosen().clip ? `<option value="clip">${t('selectedClip')}</option>` : ''}</select></label><div class="modal-actions"><button class="secondary" data-action="close-modal">${t('cancel')}</button><button class="primary" data-action="do-export">${t('export')}</button></div>` : `<h2>${t('help')}</h2><p class="shortcut-text">${esc(t('helpText'))}</p><p>${t('micHint')} ${t('recordHint')}</p><button class="primary" data-action="close-modal">${t('close')}</button>`;
  root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${t(modal === 'microphone' ? 'micProblem' : modal === 'export' ? 'exportTitle' : modal === 'rename-track' ? 'rename' : 'help')}">${contents}</section></div>`;
  (document.querySelector('#rename-value') || document.querySelector('.modal button'))?.focus();
}
function download(data, name, type) { const url = URL.createObjectURL(new Blob([data], {type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function addAudio(name, data, start = 0, trackId = null) {
  if (!trackId && project.tracks.length >= 128) throw new Error(t('trackLimit'));
  if (Object.values(project.assets).reduce((sum, a) => sum + a.data.length, data.length) > 500 * 1024 * 1024) throw new Error(t('memoryLimit'));
  const buffer = await engine.decode(data), id = uid();
  engine.buffers.set(id, buffer); project.assets[id] = {name, data};
  let track = project.tracks.find(t => t.id === trackId);
  if (!track) { track = newTrack(name.replace(/\.[^.]+$/, ''), project.tracks.length); project.tracks.push(track); }
  const clip = newClip(id, buffer.duration, start); track.clips.push(clip); selected = {trackId: track.id, clipId: clip.id};
}
async function importFiles(files) {
  const decoded = [];
  for (const file of files) { if (file.size > 500 * 1024 * 1024) throw new Error(t('fileLimit')); const data = await file.arrayBuffer(); const buffer = await engine.context.decodeAudioData(data); decoded.push({ name: file.name, data: toBase64(engine.wav(buffer)) }); }
  await importAudioData(decoded);
}
async function importAudioData(files, placement = {}) {
  if (!files?.length) return;
  const target = project.tracks.find(tr => tr.id === placement.trackId);
  if (!target && project.tracks.length + files.length > 128) throw new Error(t('trackLimit'));
  if (Object.values(project.assets).reduce((sum, a) => sum + a.data.length, 0) + files.reduce((sum, file) => sum + file.data.length, 0) > 500 * 1024 * 1024) throw new Error(t('memoryLimit'));
  // Decode the entire batch before editing the project so a failed file cannot
  // leave partially imported tracks without dirty state or an undo snapshot.
  const decoded = [];
  for (const file of files) decoded.push({ ...file, buffer: await engine.decode(file.data) });
  beforeEdit(); let start = placement.start || 0;
  for (const file of decoded) {
    const id = uid(), tr = target || newTrack(file.name.replace(/\.[^.]+$/, ''), project.tracks.length), c = newClip(id, file.buffer.duration, start);
    engine.buffers.set(id, file.buffer); project.assets[id] = { name: file.name, data: file.data };
    if (!target) project.tracks.push(tr);
    tr.clips.push(c); selected = { trackId: tr.id, clipId: c.id };
    if (target) start += file.buffer.duration;
  }
  changed();
}
function filePicker(accept, handler) { const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = accept !== '.slicetune'; input.onchange = () => task(() => handler([...input.files])); input.click(); }
async function loadProject(data) {
  const p = validateProject(JSON.parse(data)), buffers = new Map();
  for (const [id, asset] of Object.entries(p.assets)) buffers.set(id, await engine.decode(asset.data));
  for (const tr of p.tracks) for (const c of tr.clips) if (c.offset + c.duration > buffers.get(c.assetId).duration + 0.03) throw new Error(t('audioBounds'));
  clearTimeout(autosaveTimer); engine.buffers = buffers; project = p; selected = null; clipboard = null; position = 0; history = new History(); dirty = false; autosaved = false; recovery = null; saveRevision++; render();
}
async function save() {
  const revision = saveRevision, payload = serialize();
  if (desktop) { if (await desktop.saveProject(payload, project.name)) { if (revision === saveRevision) dirty = false; toast(t('success')); } }
  else { download(payload, `${project.name}.slicetune`, 'application/json'); if (revision === saveRevision) dirty = false; toast(t('savedBrowser')); }
  updateStatus();
}
async function startRecording() {
  if (recorder) { recorder.stop(); return; }
  if (busy || micPending) return;
  if (project.tracks.length >= 128) throw new Error(t('trackLimit'));
  stop(); recordingStart = position;
  recordingStream = await acquireMicrophone({ deviceId: micId ? { exact: micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  if (!recordingStream) return;
  const mimeType = ['audio/webm;codecs=opus','audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
  const chunks = [];
  try { recorder = new MediaRecorder(recordingStream, mimeType ? {mimeType} : undefined); }
  catch (error) { recordingStream.getTracks().forEach(tr => tr.stop()); recordingStream = null; throw error; }
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    const stoppedRecorder = recorder; recorder = null; recordingStream.getTracks().forEach(t => t.stop()); recordingStream = null;
    stop(); position = recordingStart;
    await task(async () => {
      const bytes = await new Blob(chunks, { type: stoppedRecorder.mimeType }).arrayBuffer();
      if (!bytes.byteLength) throw new Error(t('noRecording'));
      const buffer = await engine.context.decodeAudioData(bytes);
      beforeEdit(); await addAudio(`${t('voice')} ${new Date().toLocaleTimeString(language === 'ru' ? 'ru-RU' : 'en-GB').replaceAll(':','-')}.wav`, toBase64(engine.wav(buffer)), recordingStart); changed(); toast(t('recordingSaved'));
    });
  };
  recorder.onerror = e => { toast(e.error?.message || t('error'), true); if (recorder?.state !== 'inactive') recorder?.stop(); };
  recorder.start(250); recordingWallStart = performance.now();
  try { await engine.play(project, recordingStart); } catch (error) { recorder.stop(); throw error; }
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { /* Recording can continue if enumeration fails. */ }
  render();
}
async function acquireMicrophone(constraints = true) {
  if (micPending) return null;
  micPending = true;
  try { return await navigator.mediaDevices.getUserMedia({ audio: constraints }); }
  catch (error) {
    if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(error.name)) micProblem = 'micDenied';
    else if (['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'].includes(error.name)) { micProblem = 'micMissing'; micId = ''; }
    else if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error.name)) micProblem = 'micUnavailable';
    else throw error;
    modal = 'microphone'; render(); return null;
  } finally { micPending = false; }
}
async function demo() {
  if (dirty && !confirm(t('discard'))) return;
  clearTimeout(autosaveTimer); project = newProject(); project.name = 'Tokyo afterglow'; engine.buffers.clear(); history = new History(); selected = null; clipboard = null; position = 0;
  for (let trackIndex = 0; trackIndex < 3; trackIndex++) {
    const duration = trackIndex === 2 ? 12 : 16, sr = 48000, buffer = engine.context.createBuffer(2, sr * duration, sr);
    for (let channel = 0; channel < 2; channel++) { const samples = buffer.getChannelData(channel); for (let i = 0; i < samples.length; i++) {
      const seconds = i / sr, step = seconds % 0.5;
      if (trackIndex === 0) samples[i] = Math.sin(2 * Math.PI * (55 * seconds + 8 * (1 - Math.exp(-step * 35)))) * Math.exp(-step * 15) * 0.5;
      if (trackIndex === 1) { const f = [220, 261.6256, 329.6276, 293.6648][Math.floor(seconds / 2) % 4]; samples[i] = (Math.sin(2 * Math.PI * f * seconds) + 0.4 * Math.sin(2 * Math.PI * f * 2 * seconds)) * 0.13 * Math.sin(Math.PI * (seconds % 2) / 2); }
      if (trackIndex === 2) samples[i] = (Math.sin(seconds * Math.PI * 2 * 110) + Math.sin(seconds * Math.PI * 2 * 164.81)) * 0.06 * Math.min(1,seconds, duration - seconds);
    } }
    await addAudio(['Afterglow beat.wav','Sunset keys.wav','Night atmosphere.wav'][trackIndex], toBase64(engine.wav(buffer)), trackIndex === 2 ? 2 : 0);
    if (trackIndex === 1) project.tracks.at(-1).clips[0].reverb = 0.25;
  }
  changed();
}
async function applyProcessed(kind) {
  const {clip} = chosen(); if (!clip) return;
  const speed = Number(document.querySelector('#speed')?.value || 1), semitones = Number(document.querySelector('#pitch')?.value || 0);
  const root = Number(document.querySelector('#tune-root')?.value || 0), scale = document.querySelector('#tune-scale')?.value || 'minor', amount = Number(document.querySelector('#tune-amount')?.value || 80) / 100;
  if (kind === 'transform' && !desktop) { toast(t('desktopOnly')); return; }
  if (kind === 'tune' && clip.duration > 300) { toast(t('processingLimit')); return; }
  await task(async () => {
    const source = engine.slice(clip);
    const output = kind === 'tune' ? await correctPitch(source, engine.context, root, scale, amount, value => { const label = document.querySelector('#busy-label'); if (label) label.textContent = `${t('processing')} ${value}%`; }) : await engine.decode(await desktop.processAudio({ data: toBase64(engine.wav(source)), speed, semitones }));
    const id = uid(), data = toBase64(engine.wav(output));
    if (Object.values(project.assets).reduce((sum,a)=>sum+a.data.length,data.length)>500*1024*1024) throw new Error(t('memoryLimit'));
    beforeEdit(); engine.buffers.set(id, output); project.assets[id] = {name:`${project.assets[clip.assetId].name.replace(/\.[^.]+$/,'')} · ${kind === 'tune' ? 'Tune' : `${speed}x ${semitones > 0 ? '+' : ''}${semitones}st`}.wav`, data};
    clip.assetId = id; clip.offset = 0; clip.duration = output.duration; clip.reverse = false; clip.fadeIn = Math.min(clip.fadeIn, clip.duration); clip.fadeOut = Math.min(clip.fadeOut, clip.duration); changed(); toast(t('success'));
  });
}
async function exportMix(scope, format) {
  let output = structuredClone(project), {track,clip} = chosen();
  if (scope === 'track') { output.tracks = [structuredClone(track)]; output.tracks[0].mute = false; output.tracks[0].solo = false; }
  if (scope === 'clip') { output.tracks = [{...structuredClone(track), mute:false, solo:false, clips:[{...structuredClone(clip), start:0}]}]; }
  if (endTime(output) > 1797) throw new Error(t('exportLong'));
  const audio = await engine.render(output), data = engine.wav(audio);
  if (desktop) { if (await desktop.exportAudio(toBase64(data), format, project.name)) toast(t('success')); }
  else { download(data, `${project.name}.wav`, 'audio/wav'); toast(t('success')); }
}
async function action(name, element) {
  if ((busy || recorder) && !['stop','record','ru','en'].includes(name)) { toast(t('busy')); return; }
  const {track,clip} = chosen();
  if (name === 'ru' || name === 'en') { language = name; t = translator(language); localStorage.setItem('slicetune-language',language); desktop?.setLanguage(language); render(); return; }
  if (name === 'import') return desktop ? task(async () => importAudioData(await desktop.importAudio())) : filePicker('audio/*',importFiles);
  if (name === 'demo') return task(demo);
  if (name === 'open') { if (dirty && !confirm(t('discard'))) return; return desktop ? task(async () => { const data = await desktop.openProject(); if (data) await loadProject(data); }) : filePicker('.slicetune', async files => { if (files[0]) { if (files[0].size > 512*1024*1024) throw new Error(t('memoryLimit')); await loadProject(await files[0].text()); } }); }
  if (name === 'new') { if (dirty && !confirm(t('discard'))) return; clearTimeout(autosaveTimer); stop(false); project = newProject(); project.name = t('untitled'); engine.buffers.clear(); selected = null; clipboard = null; dirty = false; autosaved = false; history = new History(); saveRevision++; render(); return; }
  if (name === 'save') return save();
  if (name === 'play') { if (!endTime(project)) return toast(t('noAudio')); if (engine.playing) stop(); else { if (position >= endTime(project) + 3) position = 0; await engine.play(project,position); } render(); return; }
  if (name === 'stop') { if (recorder) recorder.stop(); else {stop(false); render();} return; }
  if (name === 'record') return startRecording();
  if (name === 'devices') { let stream; try { stream = await acquireMicrophone(); if (!stream) return; devices = (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'); render(); } finally { stream?.getTracks().forEach(tr=>tr.stop()); } return; }
  if (name === 'mic-settings') return desktop?.openMicrophoneSettings();
  if (name === 'retry-record') { modal = null; render(); return startRecording(); }
  if (name === 'help' || name === 'export') { if (name==='export' && !endTime(project)) return toast(t('noAudio')); modal=name; renderModal(); return; }
  if (name === 'close-modal') { modal=null; document.querySelector('#modal-root').innerHTML=''; return; }
  if (name === 'do-rename') { const value=document.querySelector('#rename-value').value.trim(),tr=project.tracks.find(tr=>tr.id===renameTrackId);if(value&&tr){beforeEdit();tr.name=value.slice(0,200);modal=null;changed();}return; }
  if (name === 'do-export') { const format=document.querySelector('#export-format').value, scope=document.querySelector('#export-scope').value; modal=null; return task(()=>exportMix(scope,format)); }
  if (name === 'recover') return task(()=>loadProject(recovery));
  if (name === 'dismiss') { recovery=null; render(); return; }
  if (name === 'mixer') { mixerVisible=!mixerVisible; render(); return; }
  if (name === 'copy') { if (clip) {clipboard=structuredClone(clip); render();} return; }
  if (name === 'paste') { if (!clipboard) return; beforeEdit(); let target=track; if (!target) { target=newTrack(t('track'),project.tracks.length); project.tracks.push(target); } const pasted={...structuredClone(clipboard),id:uid(),start:position}; target.clips.push(pasted); selected={trackId:target.id,clipId:pasted.id}; changed(); return; }
  if (name === 'delete') { if (!clip) return; beforeEdit(); track.clips=track.clips.filter(c=>c.id!==clip.id); selected={trackId:track.id}; changed(); return; }
  if (name === 'split') { if (!clip) return; if (position<=clip.start+0.01 || position>=clip.start+clip.duration-0.01) return toast(t('splitHint')); beforeEdit(); splitClip(track,clip.id,position); changed(); return; }
  if (name === 'undo' || name === 'redo') { stop(); project=history[name](project); dirty=true; autosaved=false; saveRevision++; render(); scheduleAutosave(); return; }
  if (name === 'add-track') { if (project.tracks.length>=128) return toast(t('trackLimit')); beforeEdit(); const tr=newTrack(`${t('track')} ${project.tracks.length+1}`,project.tracks.length); project.tracks.push(tr); selected={trackId:tr.id}; changed(); return; }
  if (name === 'add-asset') { if(project.tracks.length>=128)return toast(t('trackLimit')); const id=element.dataset.id,asset=project.assets[id],tr=newTrack(asset.name.replace(/\.[^.]+$/,''),project.tracks.length),c=newClip(id,engine.buffers.get(id).duration,position); beforeEdit();tr.clips.push(c);project.tracks.push(tr);selected={trackId:tr.id,clipId:c.id};changed();return; }
  if (['mute','solo','delete-track','rename-track'].includes(name)) { const tr=project.tracks.find(tr=>tr.id===element.dataset.id); if (!tr) return; if (name==='rename-track') {renameTrackId=tr.id;modal='rename-track';renderModal();return;} else { beforeEdit(); if (name==='delete-track') {project.tracks=project.tracks.filter(t=>t.id!==tr.id); if (selected?.trackId===tr.id) selected=null;} else tr[name]=!tr[name]; } changed(); return; }
  if (name==='transform'||name==='tune') return applyProcessed(name);
  if (name==='join') { if (!track?.clips.length) return; return task(async()=>{ const start=Math.min(...track.clips.map(c=>c.start)); const mix={...project,master:1,tracks:[{...track,gain:1,pan:0,mute:false,solo:false,clips:track.clips.map(c=>({...c,start:c.start-start}))}]}; const buffer=await engine.render(mix), id=uid(); beforeEdit(); project.assets[id]={name:`${track.name} · Mix.wav`,data:toBase64(engine.wav(buffer))}; engine.buffers.set(id,buffer); const c=newClip(id,buffer.duration,start); track.clips=[c]; selected={trackId:track.id,clipId:c.id}; changed(); toast(t('joined')); }); }
}
document.addEventListener('click', event => { const button=event.target.closest('[data-action]'); if (button&&!button.disabled) action(button.dataset.action,button).catch(err=>{console.error(err);toast(`${t('error')}: ${err.message}`,true);}); });
document.addEventListener('input', event=>{ const input=event.target; if(input.type==='range') { const output=input.closest('label')?.querySelector('output'); if(output) output.textContent=input.value+(input.id==='tune-amount'?'%':''); } if(input.id==='zoom') { zoom=Number(input.value); drawWaves(); } });
document.addEventListener('change', event=>{
  const el=event.target;
  if(el.id==='mic-device') {micId=el.value;return;}
  if(el.id==='zoom') {zoom=Number(el.value);render();return;}
  if(busy||recorder) return;
  if(el.id==='project-name') {beforeEdit();project.name=el.value.trim()||t('untitled');changed();return;}
  if(el.dataset.param) {const {clip}=chosen();if(clip) {beforeEdit();clip[el.dataset.param]=el.type==='checkbox'?el.checked:Number(el.value);changed();} return;}
  if(el.dataset.trackGain||el.dataset.trackPan) {const tr=project.tracks.find(t=>t.id===(el.dataset.trackGain||el.dataset.trackPan));if(tr){beforeEdit();tr[el.dataset.trackGain?'gain':'pan']=Number(el.value);changed();}return;}
  if(el.id==='master'){beforeEdit();project.master=Number(el.value);changed();}
});
document.addEventListener('keydown', event=>{
  if(modal) { if(event.key==='Escape'){modal=null;render();} if(event.key==='Enter'&&modal==='rename-track'){action('do-rename',{}).catch(err=>toast(err.message,true));} if(event.key==='Tab'){const nodes=[...document.querySelectorAll('.modal button,.modal select,.modal input')],first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}} return; }
  const editing=event.target.matches('input,select,textarea,[contenteditable=true]');
  const ctrl=event.ctrlKey||event.metaKey;
  if(editing && !(ctrl&&['s','o'].includes(event.key.toLowerCase()))) return;
  let name; if(ctrl){name={s:'save',o:'open',z:event.shiftKey?'redo':'undo',y:'redo',c:'copy',v:'paste'}[event.key.toLowerCase()];}else name={' ':'play',r:'record',s:'split',Delete:'delete',Backspace:'delete'}[event.key];
  if(name){event.preventDefault();action(name,{}).catch(err=>toast(err.message,true));}
});
document.addEventListener('dragstart',event=>{const asset=event.target.closest('[data-asset]');if(asset){event.dataTransfer.setData('application/slicetune-asset',asset.dataset.asset);event.dataTransfer.effectAllowed='copy';}});
document.addEventListener('dragover',event=>{if(event.target.closest('.workspace'))event.preventDefault();});
document.addEventListener('drop',event=>{
  const lane=event.target.closest('[data-lane]');if(!event.target.closest('.workspace'))return;event.preventDefault();if(busy||recorder)return;
  const asset=event.dataTransfer.getData('application/slicetune-asset');
  if(asset&&project.assets[asset]) { const tr=project.tracks.find(t=>t.id===lane?.dataset.lane);if(!tr)return;beforeEdit();const clip=newClip(asset,engine.buffers.get(asset).duration,Math.max(0,(event.clientX-lane.getBoundingClientRect().left)/zoom));tr.clips.push(clip);selected={trackId:tr.id,clipId:clip.id};changed(); }
  else if(event.dataTransfer.files.length) {
    if (desktop) {
      try { const paths = desktop.pathsForFiles([...event.dataTransfer.files]); const placement = lane ? { trackId: lane.dataset.lane, start: Math.max(0, (event.clientX - lane.getBoundingClientRect().left) / zoom) } : {}; task(async () => importAudioData(await desktop.importDroppedFiles(paths), placement)); }
      catch(error) { toast(`${t('error')}: ${error.message}`, true); }
    } else task(()=>importFiles([...event.dataTransfer.files]));
  }
});
document.addEventListener('pointerdown',event=>{
  if(busy||recorder||event.button!==0)return;
  const clipEl=event.target.closest('[data-clip]'),lane=event.target.closest('[data-lane]'),ruler=event.target.closest('[data-ruler]');
  if(clipEl){
    event.preventDefault();const track=project.tracks.find(tr=>tr.id===lane.dataset.lane),clip=track.clips.find(c=>c.id===clipEl.dataset.clip);selected={trackId:track.id,clipId:clip.id};
    const initial=structuredClone(clip),originX=event.clientX,originY=event.clientY,edge=event.target.dataset.edge;let pushed=false,targetTrack=track;
    const move=e=>{if(!pushed&&Math.abs(e.clientX-originX)+Math.abs(e.clientY-originY)<4)return;if(!pushed){beforeEdit();pushed=true;}Object.assign(clip,initial);const delta=(e.clientX-originX)/zoom;if(edge)trimClip(clip,edge,delta);else{clip.start=Math.max(0,e.altKey?initial.start+delta:Math.round((initial.start+delta)*10)/10);const below=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-lane]');targetTrack=project.tracks.find(t=>t.id===below?.dataset.lane)||targetTrack;}clipEl.style.left=`${clip.start*zoom}px`;clipEl.style.width=`${Math.max(8,clip.duration*zoom)}px`;};
    const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);if(pushed){if(targetTrack!==track&&!edge){track.clips=track.clips.filter(c=>c.id!==clip.id);targetTrack.clips.push(clip);selected.trackId=targetTrack.id;}changed();}else render();};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up,{once:true});
  }else if(lane||ruler){stop();position=Math.max(0,(event.clientX-(lane||ruler).getBoundingClientRect().left)/zoom);if(lane)selected={trackId:lane.dataset.lane};render();}
});
function tick(){
  if(engine.playing){position=engine.position();if(!recorder&&position>=endTime(project)+3){stop(false);render();}}
  if(recorder)position=recordingStart+(performance.now()-recordingWallStart)/1000;
  const playhead=document.querySelector('#playhead'),clock=document.querySelector('#timecode');if(playhead)playhead.style.left=`${178+position*zoom}px`;if(clock)clock.textContent=time(position);
  if(recorder&&position-recordingStart>1790&&recorder.state==='recording')recorder.stop();
  requestAnimationFrame(tick);
}
window.addEventListener('beforeunload',event=>{if(dirty||recorder){event.preventDefault();event.returnValue='';}});
window.addEventListener('resize',drawWaves);
render();tick();desktop?.setLanguage(language);
desktop?.recoverProject().then(data=>{if(data){recovery=data;render();}}).catch(()=>{});
