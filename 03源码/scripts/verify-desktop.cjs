const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('C:/Users/xing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const workspace=path.resolve(__dirname,'../..'),stage=path.join(workspace,'04备份/构建缓存/打包输入/1.3.0');
const profile=fs.mkdtempSync(path.join(workspace,'04备份/构建缓存/desktop-profile-'));
fs.writeFileSync(path.join(profile,'storage-config.json'),JSON.stringify({dataRoot:path.join(profile,'小笺数据'),backupRoot:path.join(profile,'小笺数据/备份'),autoBackup:true,backupRetention:30}));
const asar=path.join(stage,'resources/app.asar'),original=fs.readFileSync(asar);
function testArchive(){
  const header=JSON.parse(original.subarray(16,16+original.readUInt32LE(12)).toString()),base=8+original.readUInt32LE(4),items=[];
  function walk(files,prefix=''){for(const [name,item]of Object.entries(files)){if(item.files)walk(item.files,prefix+name+'/');else items.push({name:prefix+name,data:Buffer.from(original.subarray(base+Number(item.offset),base+Number(item.offset)+item.size))});}}
  walk(header.files);const pkg=items.find(i=>i.name==='package.json');const data=JSON.parse(pkg.data);data.main='desktop/test-bootstrap.js';pkg.data=Buffer.from(JSON.stringify(data));
  items.push({name:'desktop/test-bootstrap.js',data:Buffer.from(`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});BrowserWindow.prototype.show=function(){};require('./main');`)});
  const h={files:{}},buffers=[];let offset=0;
  for(const item of items){let parent=h;const parts=item.name.split('/');for(const name of parts.slice(0,-1)){parent.files[name]??={files:{}};parent=parent.files[name];}parent.files[parts.at(-1)]={size:item.data.length,offset:String(offset)};buffers.push(item.data);offset+=item.data.length;}
  const json=Buffer.from(JSON.stringify(h)),padded=Math.ceil((4+json.length)/4)*4,head=Buffer.alloc(4+padded),size=Buffer.alloc(8);head.writeUInt32LE(padded);head.writeUInt32LE(json.length,4);json.copy(head,8);size.writeUInt32LE(4);size.writeUInt32LE(head.length,4);fs.writeFileSync(asar,Buffer.concat([size,head,...buffers]));
}
(async()=>{
  testArchive();let app;
  try{
    app=await _electron.launch({executablePath:path.join(stage,'小笺.exe'),args:['--no-sandbox'],timeout:30000});
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('#dashboard-balance').waitFor();
    assert.equal(await page.evaluate(()=>typeof window.xiaojian.save),'function');
    const old={version:1,notes:[],transactions:[],tasks:[],overtimeEntries:[{id:'old',date:'2026-10-07',hours:5,note:'旧加班'}],settings:{theme:'light'}};
    await page.evaluate(old=>localStorage.setItem('sticky-life-data-v1',JSON.stringify(old)),old);await page.reload();await page.waitForFunction(()=>document.querySelector('#dashboard-balance').textContent.includes('5.0 小时'));
    const info=await page.evaluate(()=>window.xiaojian.info());assert.equal(JSON.parse(fs.readFileSync(info.recordsFile)).overtimeEntries[0].hours,5);
    await page.locator('.main-nav [data-view="logs"]').click();await page.locator('#view-logs [data-create]').click();await page.locator('[name="content"]').fill('桌面保存验证');await page.locator('#entity-form [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#entity-modal').open);
    assert.equal(JSON.parse(fs.readFileSync(info.recordsFile)).logs[0].content,'桌面保存验证');
    await page.locator('.main-nav [data-view="settings"]').click();await page.locator('#setting-theme').selectOption('dark');await page.locator('#setting-startup').selectOption('overtime');await page.locator('#setting-font').selectOption('18');await page.locator('#setting-backup-count').fill('14');await page.locator('#settings-form [type="submit"]').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    const prefs=await page.evaluate(()=>window.xiaojian.info());assert.equal(prefs.backupRetention,14);assert.equal(JSON.parse(fs.readFileSync(prefs.recordsFile)).settings.startupView,'overtime');
    await page.locator('[data-folder-action="backup-now"]').click();await page.waitForFunction(()=>document.querySelector('#setting-last-backup').textContent.endsWith('.json'));const filename=await page.locator('#setting-last-backup').innerText();assert.ok(fs.existsSync(filename));
    await page.locator('#setting-theme').selectOption('light');await page.locator('#setting-font').selectOption('16');await page.locator('#settings-form [type="submit"]').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.waitForTimeout(400);await page.screenshot({path:path.join(workspace,'05预览/preview-settings.png'),fullPage:true});
    assert.deepEqual(errors,[]);await app.close();app=null;
    app=await _electron.launch({executablePath:path.join(stage,'小笺.exe'),args:['--no-sandbox'],timeout:30000});const reopened=await app.firstWindow();await reopened.waitForFunction(()=>document.querySelector('#page-title').textContent==='加班');assert.equal(await reopened.evaluate(()=>window.xiaojian.load().then(r=>r.data.logs[0].content)),'桌面保存验证');
    console.log('PASS: real Electron preload/IPC, v1 migration to JSON, disk save, settings, backup creation, native restart persistence, startup page; isolated test profile.');
  }finally{if(app)await app.close();fs.writeFileSync(asar,original);}
})().catch(e=>{console.error(e);process.exit(1);});
