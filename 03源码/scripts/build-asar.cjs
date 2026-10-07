const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),workspace=path.resolve(root,'..');const header={files:{}},buffers=[];let offset=0;
for(const name of ['package.json','desktop/main.js','desktop/preload.js','desktop/storage.js','dist/index.html','dist/styles.css','dist/app.js']){const parts=name.split('/');let dir=header;for(const part of parts.slice(0,-1)){dir.files[part]??={files:{}};dir=dir.files[part];}const buffer=fs.readFileSync(path.join(root,name));dir.files[parts.at(-1)]={size:buffer.length,offset:String(offset)};buffers.push(buffer);offset+=buffer.length;}
const json=Buffer.from(JSON.stringify(header)),payloadSize=4+json.length,padded=Math.ceil(payloadSize/4)*4;
const headerBuffer=Buffer.alloc(4+padded);headerBuffer.writeUInt32LE(padded,0);headerBuffer.writeUInt32LE(json.length,4);json.copy(headerBuffer,8);
const sizeBuffer=Buffer.alloc(8);sizeBuffer.writeUInt32LE(4,0);sizeBuffer.writeUInt32LE(headerBuffer.length,4);
const output=path.join(workspace,'01软件','小笺','resources','app.asar'),backupDir=path.join(workspace,'04备份','应用包');
fs.mkdirSync(backupDir,{recursive:true});
const previous=fs.readFileSync(output),previousHeader=JSON.parse(previous.subarray(16,16+previous.readUInt32LE(12)).toString());
const previousPackage=previousHeader.files['package.json'],previousStart=8+previous.readUInt32LE(4)+Number(previousPackage.offset);
const previousVersion=JSON.parse(previous.subarray(previousStart,previousStart+previousPackage.size).toString()).version;
const nextVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const versionBackup=path.join(backupDir,`app-original-${previousVersion}.asar`);
if(!fs.existsSync(versionBackup))fs.copyFileSync(output,versionBackup);
fs.writeFileSync(output,Buffer.concat([sizeBuffer,headerBuffer,...buffers]));console.log('Updated '+output);
const packaged=fs.readFileSync(output),check=JSON.parse(packaged.subarray(16,16+packaged.readUInt32LE(12)).toString()),start=8+packaged.readUInt32LE(4);
for(const file of ['package.json','desktop/main.js','desktop/preload.js','desktop/storage.js','dist/index.html','dist/styles.css','dist/app.js']){let entry=check;for(const part of file.split('/'))entry=entry.files[part];require('node:assert/strict').deepEqual(packaged.subarray(start+Number(entry.offset),start+Number(entry.offset)+entry.size),fs.readFileSync(path.join(root,file)));}
console.log(`PASS: packaged ${nextVersion} matches verified source; prior version backup: ${versionBackup}`);
