import { test } from 'node:test';
import assert from 'node:assert/strict';
import audio from '../electron/audio.cjs';
import permissions from '../electron/permissions.cjs';
test('spawn resolves real unpacked FFmpeg path on Windows and Linux',()=>{
  assert.equal(audio.unpackedExecutable('C:\\Program Files\\SliceTune\\resources\\app.asar\\node_modules\\ffmpeg.exe'),'C:\\Program Files\\SliceTune\\resources\\app.asar.unpacked\\node_modules\\ffmpeg.exe');
  assert.equal(audio.unpackedExecutable('/opt/SliceTune/resources/app.asar/node_modules/ffmpeg'),'/opt/SliceTune/resources/app.asar.unpacked/node_modules/ffmpeg');
  assert.equal(audio.unpackedExecutable('/workspace/app.asar/resources/app.asar/ffmpeg'),'/workspace/app.asar/resources/app.asar.unpacked/ffmpeg');
  assert.equal(audio.unpackedExecutable('/workspace/node_modules/ffmpeg'),'/workspace/node_modules/ffmpeg');
  assert.equal(audio.unpackedExecutable('C:\\app.asar.unpacked\\ffmpeg.exe'),'C:\\app.asar.unpacked\\ffmpeg.exe');
});
test('microphone permission check and capture grant only the editor and audio',()=>{
  const url='file:///C:/Program%20Files/SliceTune/resources/app.asar/dist/index.html';
  const contents={getURL:()=>url,isDestroyed:()=>false},policy=permissions.createMediaPermissionPolicy(()=>contents,url);
  const details={requestingUrl:url,isMainFrame:true,mediaType:'audio'};
  assert.equal(policy.check(contents,'media','file://',details),true);
  assert.equal(policy.check(contents,'media','file://',{...details,mediaType:'unknown'}),true);
  assert.equal(policy.check(contents,'media','file://',{...details,mediaType:'video'}),false);
  assert.equal(policy.check(contents,'media','file://',{...details,isMainFrame:false}),false);
  assert.equal(policy.check(contents,'media','file://',{...details,requestingUrl:'file:///C:/other.html'}),false);
  assert.equal(policy.check(null,'media','file://',details),false);
  assert.equal(policy.check({...contents},'media','file://',details),false);
  assert.equal(policy.check(contents,'notifications','file://',details),false);
  for(const [mediaTypes,expected] of [[['audio'],true],[['audio','video'],false],[['video'],false],[[],false],[undefined,false]]){
    let result;policy.request(contents,'media',value=>result=value,{...details,mediaTypes});assert.equal(result,expected);
  }
});
