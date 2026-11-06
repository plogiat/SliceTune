import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { encodeWav, toBase64 } from '../src/model.js';
import { detectPitch } from '../src/autotune.js';
const require=createRequire(import.meta.url);
const {encodeFile,decodeFile,processAudio}=require('../electron/audio.cjs');
const root=await mkdtemp(path.join(tmpdir(),'slicetune-test-'));
let application;
try {
  const samples=Float32Array.from({length:96000},(_,i)=>Math.sin(2*Math.PI*445*i/48000)*.3),wav=encodeWav([samples,samples],48000);
  const input=path.join(root,'голос с пробелами.wav');await writeFile(input,new Uint8Array(wav));
  const video=path.join(root,'test.mp4');
  const generated=spawnSync(require('@ffmpeg-installer/ffmpeg').path,['-hide_banner','-y','-f','lavfi','-i','color=c=black:s=64x64:r=1','-i',input,'-t','2','-c:v','mpeg4','-c:a','aac',video],{encoding:'utf8',windowsHide:true});
  assert.equal(generated.status,0,generated.stderr);
  assert.ok(Buffer.from(await decodeFile(video),'base64').length>300000);
  const data=toBase64(wav);
  for(const format of ['wav','mp3','flac','ogg']) {const file=path.join(root,`encoded.${format}`);await encodeFile(data,file,format);assert.ok((await stat(file)).size>100);const decoded=Buffer.from(await decodeFile(file),'base64');assert.equal(decoded.toString('ascii',0,4),'RIFF');}
  const processed=await processAudio({data,speed:2,semitones:0});
  const bytes=Buffer.from(processed,'base64');assert.ok(bytes.length>150000&&bytes.length<220000,`Unexpected 2x tempo result ${bytes.length}`);
  function pitchOf(bytes) {let offset=12;while(offset+8<bytes.length){const size=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data'){const samples=Float32Array.from({length:2048},(_,i)=>bytes.readInt16LE(offset+8+(24000+i)*4)/32768);return detectPitch(samples,48000);}offset+=8+size+(size%2);}throw new Error('No PCM data');}
  assert.ok(Math.abs(pitchOf(bytes)-445)<3,'Tempo must preserve pitch');
  const shifted=Buffer.from(await processAudio({data,speed:1,semitones:12}),'base64');assert.ok(Math.abs(pitchOf(shifted)-890)<4,'Octave pitch shift');assert.ok(Math.abs(shifted.length-Buffer.from(data,'base64').length)<15000,'Pitch shift must preserve duration');
  console.log('PASS: native FFmpeg WAV/MP3/FLAC/OGG encode/decode, video extraction and 2x tempo');
  const launch=()=>electron.launch({executablePath:process.env.SLICETUNE_TEST_EXECUTABLE||undefined,args:['--no-sandbox','--use-fake-device-for-media-stream',...(process.platform==='linux'?['--headless','--ozone-platform=headless']:[]),`--user-data-dir=${path.join(root,'profile')}`,...(process.env.SLICETUNE_TEST_EXECUTABLE?[]:[process.env.SLICETUNE_TEST_APP||'.'])],timeout:30000});
  application=await launch();const page=await application.firstWindow();await page.waitForURL('**/dist/index.html');await page.locator('.empty-session').waitFor();
  if(process.env.SLICETUNE_TEST_EXECUTABLE) assert.equal(await application.evaluate(({app})=>app.isPackaged),true);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')console.error('Renderer:',message.text());});
  await application.evaluate(({dialog},{root,input})=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});
    dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:root+'/'+options.defaultPath});
  },{root,input});
  await page.locator('[data-action="import"]').first().click();await page.locator('.clip').waitFor();assert.equal(await page.locator('.asset').count(),1);
  console.log('PASS: Electron window and import');
  await page.locator('[data-action="rename-track"]').click();await page.locator('#rename-value').fill('Test voice');await page.locator('[data-action="do-rename"]').click();assert.equal(await page.locator('.track-name').textContent(),'Test voice');
  await page.locator('.effect-card summary').filter({hasText:'Скорость'}).click();await page.locator('#speed').selectOption('2');await page.locator('[data-action="transform"]').click();await page.waitForFunction(()=>document.querySelectorAll('.asset').length===2);await page.locator('.busy-overlay').waitFor({state:'hidden'});
  assert.match(await page.locator('.clip.selected .clip-label').textContent(),/2x/);
  console.log('PASS: Electron tempo processing');
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Сохранено'));
  const saved=JSON.parse(await readFile(path.join(root,'Новый проект.slicetune'),'utf8'));assert.equal(Object.keys(saved.assets).length,2);assert.ok(Math.abs(saved.tracks[0].clips[0].duration-1)<.1);
  console.log('PASS: Electron portable project save');
  for(const format of ['wav','mp3','flac','ogg']) {await page.locator('[data-action="export"]').click();await page.locator('#export-format').selectOption(format);await page.locator('[data-action="do-export"]').click();await page.locator('.busy-overlay').waitFor({state:'hidden',timeout:30000});assert.ok((await stat(path.join(root,`Новый проект.${format}`))).size>100);}
  // A real File from a file input retains its OS path across the context bridge.
  // A synthetic new File() cannot catch desktop drag-and-drop regressions.
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='drop-fixture';input.style.display='none';document.body.append(input);});
  await page.locator('#drop-fixture').setInputFiles(path.join(root,'encoded.mp3'));
  await page.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(document.querySelector('#drop-fixture').files[0]);document.querySelector('.library').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));});
  await page.waitForFunction(()=>document.querySelectorAll('.clip').length===2);assert.equal(await page.locator('.asset').count(),3);
  console.log('PASS: desktop MP3 drag-and-drop via native File path');
  await page.locator('[data-action="record"]').first().click();await page.locator('.record.active').waitFor();await page.waitForTimeout(700);await page.locator('[data-action="stop"]').click();await page.waitForFunction(()=>document.querySelectorAll('.clip').length===3);
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Автосохранено'));
  assert.deepEqual(errors,[]);await application.evaluate(({app})=>app.exit(0));await application.close();application=null;
  application=await launch();const recovered=await application.firstWindow();await recovered.waitForURL('**/dist/index.html');await recovered.locator('[data-action="recover"]').waitFor();await recovered.locator('[data-action="recover"]').click();await recovered.waitForFunction(()=>document.querySelectorAll('.clip').length===3);
  console.log('PASS: Electron import, tempo, save, four export formats, microphone recording, autosave and recovery after restart');
  await application.evaluate(({app})=>app.exit(0));await application.close();application=null;
} catch(error) {if(application){const pages=application.windows();for(const p of pages){console.error('Desktop state:',await p.locator('#save-status').textContent().catch(()=>''),await p.locator('#toast').textContent().catch(()=>''));await p.screenshot({path:path.join(tmpdir(),'slicetune-desktop-failure.png')}).catch(()=>{});}}throw error;
} finally {if(application) {await application.evaluate(({app})=>app.exit(0)).catch(()=>{});await application.close().catch(()=>{});}await rm(root,{recursive:true,force:true});}
