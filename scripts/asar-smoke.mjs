import { createPackageWithOptions } from '@electron/asar';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const dir=await mkdtemp(path.join(tmpdir(),'slicetune-asar-'));
try {
  const source=path.join(dir,'source');await mkdir(source);
  for(const file of ['electron','dist','package.json'])await cp(file,path.join(source,file),{recursive:true});
  const modules=path.join(source,'node_modules','@ffmpeg-installer');await mkdir(modules,{recursive:true});
  for(const name of ['ffmpeg',`${process.platform}-${process.arch}`])await cp(path.join('node_modules','@ffmpeg-installer',name),path.join(modules,name),{recursive:true});
  const archive=path.join(dir,'app.asar');await createPackageWithOptions(source,archive,{unpackDir:'node_modules/@ffmpeg-installer'});
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/desktop-smoke.mjs'],{stdio:'inherit',env:{...process.env,SLICETUNE_TEST_APP:archive}});child.on('error',reject);child.on('close',resolve);});
  if(code!==0)process.exitCode=code||1;
}finally{await rm(dir,{recursive:true,force:true});}
