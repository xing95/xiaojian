"use strict";
const STORAGE_KEY='sticky-life-data-v1';
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dateFrom=s=>new Date(`${s}T12:00:00`);
const shift=(s,n)=>{const d=dateFrom(s);d.setDate(d.getDate()+n);return dateKey(d);};
const weekStart=s=>shift(s,-((dateFrom(s).getDay()+6)%7));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(+dateFrom(s))&&dateKey(dateFrom(s))===s;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function migrate(data){
  if(!data||![1,2,3].includes(data.version))throw Error('不支持的备份版本');
  const out={version:3,overtimeEntries:data.overtimeEntries,leaveEntries:data.leaveEntries??[],logs:data.logs??[],reports:data.reports??[],settings:data.settings??{theme:'light'}};
  if(typeof out.settings!=='object'||Array.isArray(out.settings)||out.settings===null)throw Error('用户设置无效');
  out.settings={...out.settings,theme:out.settings.theme==='dark'?'dark':'light'};
  for(const key of ['overtimeEntries','leaveEntries','logs','reports']){
    if(!Array.isArray(out[key]))throw Error('备份缺少记录数组');
    const ids=new Set(),dates=new Set();
    for(const r of out[key]){
      if(!r)throw Error('记录无效');
      const d=key==='reports'?r.weekStart:r.date;
      if(typeof r.id!=='string'||!validDate(d)||ids.has(r.id)||dates.has(d))throw Error('日期、编号无效或存在重复记录');
      ids.add(r.id);dates.add(d);
      if(['overtimeEntries','leaveEntries'].includes(key)&&(!Number.isFinite(r.hours)||r.hours<=0||r.hours>24||typeof r.note!=='string'))throw Error('加班数据无效');
      if(!['overtimeEntries','leaveEntries'].includes(key)&&['content','issues','plan'].some(k=>typeof r[k]!=='string'))throw Error('日志或周报数据无效');
      if(key==='reports'&&weekStart(d)!==d)throw Error('周报起始日期应为周一');
    }
  }
  if(data.legacy)out.legacy=data.legacy;
  else if(data.version===1)out.legacy={notes:data.notes??[],transactions:data.transactions??[],tasks:data.tasks??[]};
  return out;
}
function weeklyDraft(state,start){
  const end=shift(start,6),logs=state.logs.filter(r=>r.date>=start&&r.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  return {content:logs.map(r=>`${r.date}\n${r.content}`).join('\n\n'),issues:logs.filter(r=>r.issues).map(r=>`${r.date}：${r.issues}`).join('\n'),plan:logs.at(-1)?.plan??'',overtime:state.overtimeEntries.filter(r=>r.date>=start&&r.date<=end).reduce((s,r)=>s+r.hours,0)};
}
function timeTotals(state) {
  const overtime=state.overtimeEntries.reduce((n,r)=>n+r.hours,0);
  const leave=(state.leaveEntries??[]).reduce((n,r)=>n+r.hours,0);
  return {overtime,leave,balance:overtime-leave};
}
function monthlyHistory(state,currentMonth=dateKey(new Date()).slice(0,7)) {
  const groups=new Map();
  for(const [key,field] of [['overtimeEntries','overtime'],['leaveEntries','leave']]) {
    for(const r of state[key]??[]) {
      const month=r.date.slice(0,7);
      if(!groups.has(month))groups.set(month,{overtime:0,leave:0,days:0,leaveDays:0});
      const group=groups.get(month);group[field]+=r.hours;group[field==='overtime'?'days':'leaveDays']++;
    }
  }
  const months=[...groups.keys(),currentMonth].sort();
  let month=months[0],last=months.at(-1),balance=0;
  const result=[];
  while(month<=last) {
    const row=groups.get(month)??{overtime:0,leave:0,days:0,leaveDays:0};
    const opening=balance,net=row.overtime-row.leave;balance+=net;
    result.push({month,...row,net,opening,balance});
    const d=dateFrom(month+'-01');d.setMonth(d.getMonth()+1);month=dateKey(d).slice(0,7);
  }
  return result.reverse();
}
if(typeof module!=='undefined')module.exports={migrate,weekStart,weeklyDraft,validDate,timeTotals,monthlyHistory};
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',async()=>{
  const $=s=>document.querySelector(s),today=()=>dateKey(new Date()),empty=()=>({version:3,overtimeEntries:[],leaveEntries:[],logs:[],reports:[],settings:{theme:'light'}});
  let state=empty(),blocked=false,view='dashboard',cursor=dateFrom(today().slice(0,7)+'-01'),context=null,deleteAction=null;
  let storageInfo=null;const api=window.xiaojian;
  const pages={settings:'设置',dashboard:'工作概览',overtime:'加班',leave:'调休',logs:'日志',reports:'周报'};
  let loadError='';
  try{
    if(api){
      const loaded=await api.load();storageInfo=loaded.info;
      if(loaded.data)state=migrate(loaded.data);
      else {const raw=localStorage.getItem(STORAGE_KEY);if(raw){state=migrate(JSON.parse(raw));storageInfo=await api.save(state);}}
    }else{const raw=localStorage.getItem(STORAGE_KEY);if(raw)state=migrate(JSON.parse(raw));}
  }catch(e){blocked=true;loadError=e.message;if(api){try{storageInfo=await api.info();}catch(_){}}}

  let toastTimer;function toast(text){clearTimeout(toastTimer);$('#toast-region').innerHTML='<div class="toast"></div>';$('#toast-region .toast').textContent=text;toastTimer=setTimeout(()=>$('#toast-region').replaceChildren(),5000);}
  async function commit(next){
    if(blocked){toast('记录无法读取，已保护原文件。请查看设置中的目录，或导入有效备份。');return false;}
    try{
      if(api)storageInfo=await api.save(next);else localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
      state=next;return true;
    }catch(e){toast('保存失败：'+e.message);return false;}
  }
  function navigate(v){view=pages[v]?v:'dashboard';if(location.hash!==`#${view}`)location.hash=view;document.querySelectorAll('[data-page]').forEach(e=>{e.hidden=e.dataset.page!==view;e.classList.toggle('is-active',!e.hidden);});document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('is-active',e.dataset.view===view));$('#quick-add-button').hidden=view==='settings';$('#page-title').textContent=pages[view];$('#page-eyebrow').textContent='加班 · 调休 · 日志 · 周报';render();}
  function card(label,value,detail){return `<article class="summary-card" style="--accent:var(--primary);--accent-soft:var(--primary-soft)"><div class="summary-label">${label}</div><strong>${value}</strong><small>${detail}</small></article>`;}
  function recordCard(r,type){const d=type==='reports'?`${r.weekStart} 至 ${shift(r.weekStart,6)}`:r.date;return `<article class="panel work-card"><div class="work-meta">${esc(d)}</div><h3>${type==='reports'?'工作周报':'工作日志'}</h3><p>${esc(r.content)}</p>${r.issues?`<h4>问题与风险</h4><p>${esc(r.issues)}</p>`:''}${r.plan?`<h4>${type==='reports'?'下周计划':'明日计划'}</h4><p>${esc(r.plan)}</p>`:''}<footer><button class="text-button" data-edit="${type}" data-id="${esc(r.id)}">编辑</button>${type==='reports'?`<button class="text-button" data-download="${esc(r.id)}">导出文本</button>`:''}<button class="text-button danger-text" data-delete="${type}" data-id="${esc(r.id)}">删除</button></footer></article>`;}
  function render(){
    const start=weekStart(today()),draft=weeklyDraft(state,start),month=today().slice(0,7),ot=state.overtimeEntries.filter(r=>r.date.startsWith(month));
    $('#dashboard-date').textContent=new Date().toLocaleDateString('zh-CN',{dateStyle:'full'});
    $('#dashboard-balance').innerHTML=balanceCards();
    $('#dashboard-summary').innerHTML=card('本月加班',`${ot.reduce((s,r)=>s+r.hours,0).toFixed(1)} 小时`,`${ot.length} 个加班日`)+card('本周日志',`${state.logs.filter(r=>r.date>=start&&r.date<=shift(start,6)).length} 篇`,'每天沉淀工作成果')+card('工作周报',`${state.reports.length} 篇`,'从日志生成，随时编辑');
    $('#dashboard-logs').innerHTML=state.logs.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,2).map(r=>recordCard(r,'logs')).join('')||'<p class="work-preview">还没有工作日志，写下今天的第一份成果。</p>';
    $('#dashboard-week').innerHTML=`<div class="work-preview">${start} 至 ${shift(start,6)}\n本周加班 ${draft.overtime.toFixed(1)} 小时\n\n${esc(draft.content||'本周尚无日志。保存日志后，可自动汇总为周报。')}</div>`;
    const q=$('#global-search').value.trim().toLowerCase(),matches=r=>`${r.date??r.weekStart} ${r.content} ${r.issues} ${r.plan}`.toLowerCase().includes(q);
    $('#logs-list').innerHTML=state.logs.filter(r=>(!$('#logs-month').value||r.date.startsWith($('#logs-month').value))&&matches(r)).sort((a,b)=>b.date.localeCompare(a.date)).map(r=>recordCard(r,'logs')).join('')||'<div class="empty-state">暂无匹配日志</div>';
    $('#reports-list').innerHTML=state.reports.filter(matches).sort((a,b)=>b.weekStart.localeCompare(a.weekStart)).map(r=>recordCard(r,'reports')).join('')||'<div class="empty-state">暂无匹配周报，点击生成周报开始整理。</div>';
    renderCalendar();renderHistory();renderLeave();renderSettings();
    if(q){const rows=[...state.logs.map(r=>({...r,type:'logs',label:'日志',date:r.date})),...state.reports.map(r=>({...r,type:'reports',label:'周报',date:r.weekStart})),...state.overtimeEntries.map(r=>({...r,type:'overtime',label:'加班',content:r.note})),...state.leaveEntries.map(r=>({...r,type:'leave',label:'调休',content:r.note}))].filter(r=>`${r.date} ${r.content} ${r.issues??''} ${r.plan??''} ${r.hours??''}`.toLowerCase().includes(q));$('#global-search-results').innerHTML=rows.slice(0,12).map(r=>`<button class="search-result" data-edit="${r.type}" data-id="${esc(r.id)}">${r.label} · ${esc(r.date)}<span>${esc((r.content||'').slice(0,40))}</span></button>`).join('')||'<div class="search-empty">没有匹配记录</div>';$('#global-search-results').hidden=false;}else $('#global-search-results').hidden=true;
  }
  function renderSettings(){
    $('#setting-theme').value=state.settings.theme==='dark'?'dark':'light';
    $('#setting-startup').value=state.settings.startupView||'dashboard';
    $('#setting-font').value=state.settings.fontSize||16;
    $('#setting-data-path').textContent=storageInfo?.recordsFile||'浏览器模式：记录保存在当前浏览器的本地存储';
    $('#setting-backup-path').textContent=storageInfo?.backupRoot||'浏览器模式：备份保存到下载目录';
    $('#setting-config-path').textContent=storageInfo?.configFile||'桌面版可设置记录和备份文件夹';
    $('#setting-last-backup').textContent=storageInfo?.lastBackup||'点击「立即备份」生成独立备份文件';
    $('#setting-auto-backup').checked=storageInfo?.autoBackup!==false;
    $('#setting-backup-count').value=storageInfo?.backupRetention||30;
    document.querySelectorAll('[data-desktop-setting]').forEach(e=>e.disabled=!api);
  }
  $('#settings-form').addEventListener('submit',async e=>{
    e.preventDefault();const count=Number($('#setting-backup-count').value);
    if(!Number.isInteger(count)||count<7||count>365)return toast('自动备份保留数量应为 7 至 365 份');
    const next=structuredClone(state);Object.assign(next.settings,{theme:$('#setting-theme').value,startupView:$('#setting-startup').value,fontSize:Number($('#setting-font').value)});
    if(await commit(next)){
      if(api){try{storageInfo=await api.preferences({autoBackup:$('#setting-auto-backup').checked,backupRetention:count});}catch(e){toast('备份设置未保存：'+e.message);return;}}
      applyTheme();renderSettings();toast('设置已保存');
    }
  });
  document.querySelectorAll('[data-folder-action]').forEach(b=>b.addEventListener('click',async()=>{
    if(!api)return;try{
      const action=b.dataset.folderAction;
      if(action==='data'||action==='install'){const info=await api.chooseDataFolder(action==='install'?'install':'choose');if(info){storageInfo=info;toast('位置已更换，原记录和备份仍保留');}}
      else if(action==='backup'){const info=await api.chooseBackupFolder();if(info){storageInfo=info;toast('备份位置已更换，原文件仍保留');}}
      else if(action==='backup-now'){const file=await api.backup();storageInfo=await api.info();toast('备份已保存：'+file);}
      else await api.openFolder(action==='open-data'?'data':'backup');
      renderSettings();
    }catch(e){toast('操作失败：'+e.message);}
  }));
  function balanceCards(){const t=timeTotals(state);return card('累计加班',`${t.overtime.toFixed(1)} 小时`,'所有已记录的加班时长')+card('累计调休',`${t.leave.toFixed(1)} 小时`,'所有已记录的调休时长')+card('实际结余',`${t.balance.toFixed(1)} 小时`,t.balance<0?'调休超出已记录加班，请核对历史记录':'累计加班 − 累计调休');}
  function renderHistory(){
    $('#overtime-balance').innerHTML=balanceCards();
    const all=monthlyHistory(state),years=[...new Set(all.map(r=>r.month.slice(0,4)))],selected=$('#history-year').value;
    $('#history-year').innerHTML='<option value="">全部年份</option>'+years.map(y=>`<option value="${y}">${y} 年</option>`).join('');$('#history-year').value=selected;
    const rows=all.filter(r=>!selected||r.month.startsWith(selected));
    $('#history-summary').textContent=`${selected?selected+' 年':'全部历史'}：加班 ${rows.reduce((n,r)=>n+r.overtime,0).toFixed(1)} 小时，调休 ${rows.reduce((n,r)=>n+r.leave,0).toFixed(1)} 小时，净增加 ${rows.reduce((n,r)=>n+r.net,0).toFixed(1)} 小时`;
    $('#history-body').innerHTML=rows.map(r=>`<tr><td><button class="text-button" data-month="${r.month}">${r.month}</button></td><td>${r.overtime.toFixed(1)}</td><td>${r.days}</td><td>${r.leave.toFixed(1)}</td><td>${r.net.toFixed(1)}</td><td>${r.opening.toFixed(1)}</td><td class="${r.balance<0?'negative-balance':''}">${r.balance.toFixed(1)}</td></tr>`).join('');
  }
  function renderLeave(){
    $('#leave-summary').innerHTML=balanceCards();
    const month=$('#leave-month').value,q=$('#global-search').value.trim().toLowerCase();
    const rows=state.leaveEntries.filter(r=>(!month||r.date.startsWith(month))&&`${r.date} ${r.note} ${r.hours}`.toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));
    $('#leave-list').innerHTML=rows.map(r=>`<article class="panel work-card leave-card"><div><div class="work-meta">${r.date}</div><h3>调休 ${r.hours.toFixed(1)} 小时</h3><p>${esc(r.note||'未填写备注')}</p></div><footer><button class="text-button" data-edit="leave" data-id="${esc(r.id)}">编辑</button><button class="text-button danger-text" data-delete="leaveEntries" data-id="${esc(r.id)}">删除</button></footer></article>`).join('')||'<div class="empty-state">暂无调休记录，点击「记录调休」添加。</div>';
    $('#leave-filter-total').textContent=`当前列表：${rows.length} 条，共 ${rows.reduce((n,r)=>n+r.hours,0).toFixed(1)} 小时`;
  }
  function renderCalendar(){const month=dateKey(cursor).slice(0,7),rows=state.overtimeEntries.filter(r=>r.date.startsWith(month)),total=rows.reduce((s,r)=>s+r.hours,0),leave=state.leaveEntries.filter(r=>r.date.startsWith(month)).reduce((n,r)=>n+r.hours,0);$('#overtime-summary').innerHTML=card('本月累计',`${total.toFixed(1)} 小时`,'如实记录每一份付出')+card('加班天数',`${rows.length} 天`,'每个日期一条记录')+card('当月调休',`${leave.toFixed(1)} 小时`,`当月净增加 ${(total-leave).toFixed(1)} 小时`);$('#calendar-month').value=month;$('#calendar-title').textContent=`${cursor.getFullYear()} 年 ${cursor.getMonth()+1} 月`;const first=weekStart(dateKey(cursor));$('#overtime-month-label').textContent=month+' 月度统计';$('#calendar-grid').innerHTML=Array.from({length:42},(_,i)=>{const d=shift(first,i),r=state.overtimeEntries.find(r=>r.date===d),l=state.leaveEntries.find(r=>r.date===d);return `<button class="calendar-day ${d.startsWith(month)?'':'is-other-month'} ${d===today()?'is-today':''}" data-date="${d}" role="gridcell" aria-label="${d}${r?` 加班${r.hours}小时`:''}${l?` 调休${l.hours}小时`:''}"><span class="day-number">${dateFrom(d).getDate()}</span>${r?`<span class="hours-badge">加 ${r.hours}h</span>`:''}${l?`<span class="leave-badge">休 ${l.hours}h</span>`:''}</button>`;}).join('');}
  function field(name,label,value='',type='textarea'){return `<label class="work-field">${label}${type==='textarea'?`<textarea name="${name}" maxlength="20000">${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${name==='hours'?'min="0.5" max="24" step="0.5"':''} required>`}</label>`;}
  function open(type,id=null,date=today()){
    if(!['overtime','leave','logs','reports'].includes(type))return;
    const list=type==='overtime'?'overtimeEntries':type==='leave'?'leaveEntries':type,r=state[list].find(r=>id?r.id===id:(type==='reports'?r.weekStart===weekStart(date):r.date===date)),start=r?.weekStart??weekStart(date);
    context={type,list,id:r?.id};$('#modal-title').textContent={overtime:'记录加班',leave:'记录调休',logs:'工作日志',reports:'工作周报'}[type];$('#modal-eyebrow').textContent=r?'编辑记录':'新建记录';
    const draft=type==='reports'?(r??weeklyDraft(state,start)):r??{};
    $('#modal-fields').innerHTML=field('date',type==='reports'?'周内任意日期（自动归到周一）':'日期',type==='reports'?start:r?.date??date,'date')+(['overtime','leave'].includes(type)?field('hours',type==='leave'?'调休时长（小时）':'加班时长（小时）',r?.hours??2,'number')+field('note',type==='leave'?'调休备注':'加班内容',r?.note??''):field('content',type==='reports'?'本周成果':'今日成果',draft.content)+field('issues','问题与风险',draft.issues)+field('plan',type==='reports'?'下周计划':'明日计划',draft.plan))+(type==='reports'?'<button type="button" class="secondary-button" id="regenerate">按所选周重新汇总日志</button><p class="work-meta">汇总会替换当前表单内容，保存后才更新周报。</p><p id="report-hours" class="work-meta"></p>':'')+'<p class="work-error" id="form-error" role="alert"></p>'+(r&&['overtime','leave'].includes(type)?`<button type="button" class="text-button danger-text" data-delete="${list}" data-id="${esc(r.id)}">删除这条记录</button>`:'');
    if(type==='reports')$('#report-hours').textContent=`本周加班 ${weeklyDraft(state,start).overtime} 小时`;
    $('#entity-modal').showModal();$('#entity-form').elements.date.focus();
  }
  $('#entity-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target.elements,fail=m=>$('#form-error').textContent=m;if(!validDate(f.date.value))return fail('请选择有效日期');const d=context.type==='reports'?weekStart(f.date.value):f.date.value,existing=state[context.list].find(r=>(r.date??r.weekStart)===d);if(existing&&existing.id!==context.id)return fail('该日期已有记录，请先编辑原记录。');const r={id:context.id??crypto.randomUUID(),updatedAt:new Date().toISOString()};if(['overtime','leave'].includes(context.type)){const h=Number(f.hours.value);if(!Number.isFinite(h)||h<0.5||h>24||h*2!==Math.round(h*2))return fail('时长应为 0.5 至 24 小时，以 0.5 为步长');Object.assign(r,{date:d,hours:h,note:f.note.value.trim()});}else{if(!f.content.value.trim())return fail('请填写工作成果');Object.assign(r,{[context.type==='reports'?'weekStart':'date']:d,content:f.content.value.trim(),issues:f.issues.value.trim(),plan:f.plan.value.trim()});}const next=structuredClone(state);next[context.list]=next[context.list].filter(x=>x.id!==r.id);next[context.list].push(r);if(await commit(next)){$('#entity-modal').close();render();toast('已保存');}});
  document.addEventListener('click',async e=>{const b=e.target.closest('button,a');if(!b)return;if(b.dataset.view||b.dataset.go||b.dataset.navigate){e.preventDefault();navigate(b.dataset.view??b.dataset.go??b.dataset.navigate);}if(b.dataset.create)open(b.dataset.create);if(b.dataset.edit){$('#global-search-results').hidden=true;open(b.dataset.edit,b.dataset.id);}if(b.dataset.date)open('overtime',null,b.dataset.date);if(b.dataset.month){cursor=dateFrom(b.dataset.month+'-01');renderCalendar();$('#calendar-title').scrollIntoView({behavior:'smooth',block:'center'});}if(b.matches('.modal-close,.modal-cancel'))$('#entity-modal').close();if(b.dataset.delete){const list=b.dataset.delete==='overtime'?'overtimeEntries':b.dataset.delete;confirm('删除这条记录？','删除后无法在应用内恢复，请确认。',async()=>{const next=structuredClone(state);next[list]=next[list].filter(r=>r.id!==b.dataset.id);if(await commit(next)){$('#entity-modal').close();render();toast('已删除');}});}if(b.id==='history-jump')$('.history-panel').scrollIntoView({behavior:'smooth',block:'start'});if(b.id==='regenerate'){const f=$('#entity-form').elements;if(!validDate(f.date.value))return;const draft=weeklyDraft(state,weekStart(f.date.value));for(const k of ['content','issues','plan'])f[k].value=draft[k];$('#report-hours').textContent=`本周加班 ${draft.overtime} 小时`;}if(b.dataset.download){const r=state.reports.find(r=>r.id===b.dataset.download);download(`周报-${r.weekStart}.txt`,`工作周报 ${r.weekStart} 至 ${shift(r.weekStart,6)}\n\n本周成果\n${r.content}\n\n问题与风险\n${r.issues}\n\n下周计划\n${r.plan}\n\n本周加班：${weeklyDraft(state,r.weekStart).overtime} 小时`,'text/plain');}if(b.id==='history-export'){const rows=monthlyHistory(state).filter(r=>!$('#history-year').value||r.month.startsWith($('#history-year').value));download('小笺月度统计-'+today()+'.csv','\uFEFF月份,加班小时,加班天数,调休小时,当月净增加,月初结余,月末结余\r\n'+rows.map(r=>[r.month,r.overtime.toFixed(1),r.days,r.leave.toFixed(1),r.net.toFixed(1),r.opening.toFixed(1),r.balance.toFixed(1)].join(',')).join('\r\n'),'text/csv');}if(b.dataset.dataAction==='export'){try{if(api){const file=await api.backup();toast('备份已保存：'+file);storageInfo=await api.info();renderSettings();}else download(`小笺备份-${today()}.json`,blocked?localStorage.getItem(STORAGE_KEY):JSON.stringify(state,null,2),'application/json');}catch(e){toast('备份失败：'+e.message);}}if(b.dataset.dataAction==='import')$('#import-input').click();if(b.dataset.dataAction==='clear')confirm('清空全部数据？','会清空所有工作记录和旧版存档，请先导出备份。',async()=>{if(await commit(empty())){render();toast('已清空');}});});
  function confirm(title,message,action){$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;deleteAction=action;$('#confirm-modal').showModal();}
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text??''],{type:`${type};charset=utf-8`}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('#confirm-cancel').onclick=()=>{$('#confirm-modal').close();deleteAction=null;};$('#confirm-accept').onclick=async()=>{$('#confirm-modal').close();const action=deleteAction;deleteAction=null;await action?.();};
  $('#import-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const imported=migrate(JSON.parse(await file.text()));confirm('导入备份并覆盖当前数据？','请先导出现有备份。确认后替换全部记录。',async()=>{const wasBlocked=blocked;blocked=false;if(await commit(imported)){applyTheme();render();toast('导入成功');}else blocked=wasBlocked;});}catch(error){toast('导入失败：'+error.message);}};
  $('#calendar-prev').onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1,12);renderCalendar();};$('#calendar-next').onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1,12);renderCalendar();};$('#calendar-today').onclick=()=>{cursor=dateFrom(today().slice(0,7)+'-01');renderCalendar();};$('#calendar-month').onchange=e=>{if(e.target.value){cursor=dateFrom(e.target.value+'-01');renderCalendar();}};$('#history-year').onchange=renderHistory;$('#leave-month').onchange=renderLeave;$('#leave-all').onclick=()=>{$('#leave-month').value='';renderLeave();};$('#logs-month').onchange=render;$('#logs-all').onclick=()=>{$('#logs-month').value='';render();};$('#global-search').oninput=render;$('#quick-add-button').onclick=()=>open(view==='dashboard'?'logs':view);
  $('#data-menu-button').onclick=()=>{$('#data-menu').hidden=!$('#data-menu').hidden;$('#data-menu-button').setAttribute('aria-expanded',String(!$('#data-menu').hidden));};
  function applyTheme(){document.documentElement.style.fontSize=(state.settings.fontSize||16)+'px';document.body.style.fontSize=(state.settings.fontSize||16)+'px';document.documentElement.dataset.theme=state.settings.theme;$('.theme-label').textContent=state.settings.theme==='dark'?'浅色模式':'深色模式';}$('#theme-toggle').onclick=async()=>{const next=structuredClone(state);next.settings.theme=state.settings.theme==='dark'?'light':'dark';if(await commit(next))applyTheme();};
  $('#entity-modal').addEventListener('click',e=>{if(e.target===$('#entity-modal'))$('#entity-modal').close();});
  document.addEventListener('click',e=>{if(!e.target.closest('.global-search-wrap'))$('#global-search-results').hidden=true;if(!e.target.closest('.data-menu-wrap')){$('#data-menu').hidden=true;$('#data-menu-button').setAttribute('aria-expanded','false');}});
  $('#global-search').onkeydown=e=>{if(e.key==='Escape'){$('#global-search').value='';render();}};
  window.addEventListener('storage',e=>{if(api||e.key!==STORAGE_KEY||!e.newValue)return;try{state=migrate(JSON.parse(e.newValue));blocked=false;applyTheme();render();toast('已同步其他窗口的数据');}catch(_){toast('其他窗口的数据无效，已保留当前记录');}});
  window.addEventListener('hashchange',()=>{if(location.hash.slice(1)!==view)navigate(location.hash.slice(1));});applyTheme();navigate(location.hash.slice(1)||state.settings.startupView);if(blocked)toast('原有记录无法读取，已保护原始数据：'+loadError);
});
