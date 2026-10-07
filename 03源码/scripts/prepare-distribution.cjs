const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'01软件/小笺');
const version=JSON.parse(fs.readFileSync(path.join(root,'03源码/package.json'),'utf8')).version;
const archive=path.join(root,'04备份/裁剪文件/1.2.0'),staging=path.join(root,'04备份/构建缓存/打包输入',version);
fs.mkdirSync(archive,{recursive:true});
const total=dir=>fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?total(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0);
const before=total(source);
for(const entry of fs.readdirSync(path.join(source,'locales'))){
  if(['zh-CN.pak','en-US.pak'].includes(entry))continue;
  const old=path.join(source,'locales',entry),dest=path.join(archive,'locales',entry);fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(!fs.existsSync(dest))fs.copyFileSync(old,dest);fs.unlinkSync(old);
}
for(const name of ['debug.log','Uninstall 小笺.exe']){
  const old=path.join(source,name);if(fs.existsSync(old)){const dest=path.join(archive,name);if(!fs.existsSync(dest))fs.copyFileSync(old,dest);fs.unlinkSync(old);}
}
const runtime=['小笺.exe','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','LICENSE.electron.txt','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','uninstallerIcon.ico','v8_context_snapshot.bin','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll','locales/zh-CN.pak','locales/en-US.pak','resources/app.asar','resources/elevate.exe'];
fs.mkdirSync(staging,{recursive:true});
function checkStage(directory,prefix=''){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())checkStage(path.join(directory,entry.name),name+'/');
    else if(!runtime.includes(name))throw Error(`打包输入包含非程序文件：${name}。请先归档，以免记录被打入安装包。`);
  }
}
checkStage(staging);
for(const name of runtime){const dest=path.join(staging,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,name),dest);}
// Keep unknown/user-created directories and files on uninstall and upgrade.
const include='!macro customRemoveFiles\n'+runtime.map(name=>`  Delete "$INSTDIR\\${name.replaceAll('/','\\')}"`).join('\n')+'\n  Delete "$INSTDIR\\Uninstall 小笺.exe"\n  RMDir "$INSTDIR\\resources"\n  RMDir "$INSTDIR\\locales"\n  RMDir "$INSTDIR"\n!macroend\n';
fs.writeFileSync(path.join(root,'03源码/installer-data.nsh'),include);
const report={version,beforeBytes:Math.max(before,total(source)+total(archive)),afterBytes:total(source),staging,retainedLanguages:['zh-CN','en-US'],excludedUserData:true};
fs.writeFileSync(path.join(root,'06文档/体积优化.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
