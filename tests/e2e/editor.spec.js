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
