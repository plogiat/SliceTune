import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('demo session: playback, split, undo, reverse, portable save and export',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.getByRole('heading',{name:'Здесь начинается ваш звук'})).toBeVisible();
  await page.locator('[data-action="en"]').click();await expect(page.getByRole('heading',{name:'Your sound starts here'})).toBeVisible();
  await page.locator('[data-action="demo"]').first().click();await expect(page.locator('.clip')).toHaveCount(3);await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.locator('[data-action="play"]').click();await page.waitForTimeout(350);await expect(page.locator('#timecode')).not.toHaveText('00:00.000');await page.locator('[data-action="stop"]').click();
  const ruler=page.locator('[data-ruler]');await ruler.click({position:{x:160,y:20}});await page.locator('.clip').first().click();await page.locator('[data-action="split"]').click();await expect(page.locator('.clip')).toHaveCount(4);
  await page.locator('[data-action="undo"]').click();await expect(page.locator('.clip')).toHaveCount(3);
  await page.locator('[data-param="reverse"]').check();await expect(page.locator('.clip.selected .clip-label')).toContainText('↶');
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="save"]').click();const projectDownload=await downloadPromise;const projectPath=await projectDownload.path();expect(projectDownload.suggestedFilename()).toBe('Tokyo afterglow.slicetune');
  await page.locator('[data-action="export"]').click();const wavePromise=page.waitForEvent('download');await page.locator('[data-action="do-export"]').click();const wave=await wavePromise;expect(wave.suggestedFilename()).toBe('Tokyo afterglow.wav');
  const pcm=await readFile(await wave.path());expect(pcm.toString('ascii',0,4)).toBe('RIFF');let energy=0;for(let i=44;i<pcm.length;i+=200)energy+=(pcm.readInt16LE(i)/32768)**2;expect(energy).toBeGreaterThan(1);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);await page.locator('[data-action="new"]').click();await expect(page.locator('.clip')).toHaveCount(0);
  const choose=page.waitForEvent('filechooser');await page.locator('[data-action="open"]').click();await(await choose).setFiles(projectPath);await expect(page.locator('.clip')).toHaveCount(3);expect(errors).toEqual([]);
});
test('records microphone into a new playable track',async({page})=>{await page.goto('/');await page.locator('[data-action="record"]').first().click();await expect(page.locator('.record.active')).toBeVisible();await page.waitForTimeout(700);await page.locator('[data-action="stop"]').click();await expect(page.locator('.clip')).toHaveCount(1);await expect(page.locator('.asset')).toHaveCount(1);await page.locator('[data-action="play"]').click();await expect(page.locator('[data-action="play"]')).toHaveAttribute('aria-label','Пауза');});
test('vocal correction produces a new asset and supports undo',async({page})=>{await page.goto('/');await page.locator('[data-action="demo"]').first().click();await expect(page.locator('.clip')).toHaveCount(3);await page.locator('.clip').nth(1).click();await page.locator('.tune-card summary').click();await page.locator('[data-action="tune"]').click();await expect(page.locator('.asset')).toHaveCount(4,{timeout:60000});await expect(page.locator('.busy-overlay')).toHaveCount(0);await expect(page.locator('.clip.selected .clip-label')).toContainText('Tune');await page.locator('[data-action="undo"]').click();await expect(page.locator('.clip.selected .clip-label')).not.toContainText('Tune');});
test('failed import stays visible after the busy overlay closes',async({page})=>{
  await page.addInitScript(()=>{window.desktop={platform:'win32',setLanguage:async()=>{},recoverProject:async()=>null,importAudio:async()=>{throw new Error('broken.wav: no audio stream');}};});
  await page.goto('/');await page.locator('[data-action="import"]').first().click();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);await expect(page.locator('#toast.show.error')).toContainText('broken.wav');await expect(page.locator('.clip')).toHaveCount(0);
});
test('system-denied microphone shows Windows instructions and permits retry',async({page})=>{
  await page.addInitScript(()=>{
    window.desktop={platform:'win32',setLanguage:async()=>{},recoverProject:async()=>null,openMicrophoneSettings:async()=>{window.settingsOpened=true;}};
    const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let attempts=0;
    navigator.mediaDevices.getUserMedia=async constraints=>{if(++attempts===1)throw new DOMException('Permission denied by system','NotAllowedError');return get(constraints);};
  });
  await page.goto('/');await page.locator('[data-action="record"]').first().click();
  await expect(page.getByRole('dialog',{name:'Не удалось начать запись'})).toBeVisible();await expect(page.getByRole('dialog')).toContainText('классическим приложениям');
  await page.locator('[data-action="mic-settings"]').click();expect(await page.evaluate(()=>window.settingsOpened)).toBe(true);
  await page.locator('[data-action="retry-record"]').click();await expect(page.locator('.record.active')).toBeVisible();await page.waitForTimeout(500);await page.locator('[data-action="stop"]').click();await expect(page.locator('.clip')).toHaveCount(1);
});
test('sliders change live while transport and clock keep running',async({page})=>{
 await page.goto('/');await page.locator('[data-action="demo"]').first().click();await expect(page.locator('.clip')).toHaveCount(3);await page.locator('.clip').nth(1).click();await page.locator('[data-action="play"]').click();
 const initial=await page.locator('#timecode').textContent();
 for(const selector of ['#master','[data-track-gain]','[data-track-pan]','[data-param="gain"]','[data-param="low"]','[data-param="fadeIn"]','#zoom']){
  await page.locator(selector).first().evaluate(el=>{el.value=el.id==='zoom'?'35':el.dataset.param==='low'?'5':'0.4';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(page.locator('[data-action="play"]')).toHaveAttribute('aria-label','Пауза');
 }
 await page.waitForTimeout(200);expect(await page.locator('#timecode').textContent()).not.toBe(initial);
 // Exercise the live graph itself: controls update AudioParams without replacing sources.
 const state=await page.evaluate(async()=>{const {AudioEngine}=await import('/src/engine.js');const {newProject,newTrack,newClip}=await import('/src/model.js');const e=new AudioEngine(),p=newProject(),t=newTrack('test');const b=e.context.createBuffer(1,48000*3,48000);b.getChannelData(0).fill(.1);e.buffers.set('a',b);t.clips.push(newClip('a',3));p.tracks.push(t);await e.play(p,0);const source=e.nodes[0];t.pan=.7;t.gain=.3;t.clips[0].low=6;e.update(p);await new Promise(r=>setTimeout(r,100));const result={same:source===e.nodes[0],playing:e.playing,pan:e.graph.tracks.get(t.id).pan.pan.value,eq:e.graph.clips.get(t.clips[0].id).filters.lowshelf.gain.value};e.stop();await e.context.close();return result;});
 expect(state.same).toBe(true);expect(state.playing).toBe(true);expect(state.pan).toBeCloseTo(.7,1);expect(state.eq).toBeCloseTo(6,1);
});
test('drag a waveform range, delete only that interval, then undo',async({page})=>{
 await page.goto('/');await page.locator('[data-action="demo"]').first().click();await expect(page.locator('.clip')).toHaveCount(3);
 const lane=page.locator('[data-lane]').first(),rect=await lane.boundingBox();await page.mouse.move(rect.x+64,rect.y+55);await page.mouse.down();await page.mouse.move(rect.x+192,rect.y+55,{steps:8});await page.mouse.up();
 await expect(page.locator('.range-selection')).toBeVisible();await page.keyboard.press('Delete');await expect(lane.locator('.clip')).toHaveCount(2);
 const bounds=await lane.locator('.clip').evaluateAll(clips=>clips.map(c=>[parseFloat(c.style.left),parseFloat(c.style.width)]));expect(bounds).toEqual([[0,64],[192,320]]);
 await page.locator('[data-action="undo"]').click();await expect(lane.locator('.clip')).toHaveCount(1);
});
