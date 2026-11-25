const $=id=>document.getElementById(id);
const state={role:'guest',user:null,engine:'sqlite',engines:{sqlite:true,postgres:false,mysql:false},workspaces:[],sqliteDb:null,SQL:null,workspace:null,history:[],dirty:false,teacherStudents:[],currentStudent:null,loading:false,saveTimer:null};
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message,error=false){const e=document.createElement('div');e.className='toast-msg'+(error?' err':'');e.textContent=message;$('toast').append(e);setTimeout(()=>e.remove(),4600);}
async function api(action,{method='GET',data,query={}}={}) {
  const qs=new URLSearchParams({action,...query});
  const response=await fetch('/api?'+qs,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  let payload;try{payload=await response.json();}catch{throw new Error('Neizdevās nolasīt servera atbildi.');}
  if(!response.ok)throw new Error(payload.error||'Servera kļūda.');return payload;
}
const ENGINES={sqlite:{title:'SQLite',desc:'Iegulta datubāze tavā pārlūkā. Saglabāšana mākonī.',example:'sqlite'},postgres:{title:'PostgreSQL',desc:'Īsts PostgreSQL serveris. Tikai tev pieejama shēma un SQL objekti.',example:'postgres'},mysql:{title:'MySQL',desc:'Īsts MySQL serveris. Tev ir personīga datubāze.',example:'mysql'}};
const templates={
 sqlite:[
  {name:'Sākt: klienti un pasūtījumi',sql:`-- SQLite: datubāze klientiem un pasūtījumiem\nPRAGMA foreign_keys = ON;\n\nCREATE TABLE IF NOT EXISTS customers (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE\n);\nCREATE TABLE IF NOT EXISTS orders (\n  id INTEGER PRIMARY KEY,\n  customer_id INTEGER NOT NULL,\n  total REAL NOT NULL CHECK (total >= 0),\n  FOREIGN KEY (customer_id) REFERENCES customers(id)\n);\n\nINSERT INTO customers (name,email) VALUES ('Anna','anna@example.test');\nSELECT * FROM customers;`},
  {name:'Pārbaudīt ārējo atslēgu',sql:`PRAGMA foreign_keys = ON;\n-- Tam vajadzētu izraisīt FOREIGN KEY kļūdu,\n-- ja klients ar ID 999 neeksistē.\nINSERT INTO orders (customer_id,total) VALUES (999,25.50);`},
  {name:'Apskatīt datubāzes tabulas',sql:`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`},
  {name:'EXPLAIN QUERY PLAN',sql:`EXPLAIN QUERY PLAN SELECT * FROM customers WHERE email='anna@example.test';`}
 ],
 postgres:[
  {name:'Sākt: klienti un pasūtījumi',sql:`-- PostgreSQL: personīgā shēma\nCREATE TABLE IF NOT EXISTS customers (\n  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE\n);\nCREATE TABLE IF NOT EXISTS orders (\n  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  customer_id BIGINT NOT NULL REFERENCES customers(id),\n  total NUMERIC(10,2) CHECK (total >= 0)\n);\nSELECT * FROM customers;`},
  {name:'Datu ievietošana',sql:`INSERT INTO customers(name,email) VALUES ('Anna','anna@example.test') RETURNING *;`},
  {name:'Relāciju tests (paredzēta kļūda)',sql:`INSERT INTO orders(customer_id,total) VALUES (999,25.50);`},
  {name:'EXPLAIN vaicājums',sql:`EXPLAIN SELECT * FROM customers WHERE email='anna@example.test';`},
  {name:'Tabulu saraksts',sql:`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema();`}
 ],
 mysql:[
  {name:'Sākt: klienti un pasūtījumi',sql:`-- MySQL: izpildi CREATE TABLE pa vienam!\nCREATE TABLE IF NOT EXISTS customers (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(100) NOT NULL,\n  email VARCHAR(160) UNIQUE\n) ENGINE=InnoDB;`},
  {name:'Izveidot pasūtījumus',sql:`CREATE TABLE IF NOT EXISTS orders (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  customer_id INT NOT NULL,\n  total DECIMAL(10,2) NOT NULL CHECK (total >= 0),\n  FOREIGN KEY (customer_id) REFERENCES customers(id)\n) ENGINE=InnoDB;`},
  {name:'Pievienot datus',sql:`INSERT INTO customers(name,email) VALUES ('Anna','anna@example.test');`},
  {name:'Pārbaudīt FOREIGN KEY',sql:`INSERT INTO orders(customer_id,total) VALUES (999,25.50);`},
  {name:'Tabulu saraksts',sql:`SHOW TABLES;`}
 ]
};
function setSaveStatus(label){$('saved-status').textContent=label;}
function setLoading(value){state.loading=value;$('run-sql').disabled=value;$('save-workspace').disabled=value;$('run-sql').innerHTML=value?'◌ Izpilda...':'<span>▶</span> Izpildīt SQL';}
function initialDraft(engine){return `-- Laipni lūdzam ${ENGINES[engine].title} laboratorijā!\n-- Izmanto “Piemēri”, lai sāktu darbu.\n\n`}
function fillTemplates(){const select=$('template-select');select.innerHTML='<option value="">Izvēlies piemēru...</option>'+templates[state.engine].map((x,i)=>`<option value="${i}">${escapeHtml(x.name)}</option>`).join('');}
function lines(){const t=$('sql-editor');$('line-numbers').textContent=Array.from({length:Math.min(500,t.value.split('\n').length)},(_,i)=>i+1).join('\n');$('line-numbers').scrollTop=t.scrollTop;}
function b64Bytes(text){if(!text)return null;const binary=atob(text);const arr=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)arr[i]=binary.charCodeAt(i);return arr;}
function bytesB64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
async function loadSqlite(base64){
  if(!state.SQL){if(typeof window.initSqlJs!=='function')throw new Error('Nevar ielādēt SQLite dzini. Pārbaudi, vai Vercel build ir izpildīts.');state.SQL=await window.initSqlJs({locateFile:name=>'/vendor/'+name});}
  if(state.sqliteDb)try{state.sqliteDb.close();}catch{}
  state.sqliteDb=base64?new state.SQL.Database(b64Bytes(base64)):new state.SQL.Database();
  state.sqliteDb.run('PRAGMA foreign_keys = ON;');
}
async function refreshWorkspace(){
  const engine=state.engine;const response=await api('workspace',{query:{engine}});
  if(engine!==state.engine)return;
  state.workspace=response.workspace;state.history=response.history;state.dirty=false;
  if(engine==='sqlite')await loadSqlite(response.workspace.sqlite_data||'');
  $('sql-editor').value=response.workspace.draft_sql||initialDraft(engine);lines();
  const ready=engine==='sqlite'||response.workspace.provisioned;
  $('not-configured').classList.toggle('hidden',response.configured);
  $('provision-panel').classList.toggle('hidden',!response.configured||ready);
  $('editor-content').classList.toggle('hidden',!response.configured||!ready);
  $('engine-ready-label').textContent=engine==='sqlite'?'SQLite ir gatava':ready?'Datubāze ir gatava':'Nepieciešama inicializācija';
  $('workspace-hint').textContent=engine==='sqlite'?'SQLite fails tiek glabāts Neon kontā':'Katram jaunietim ir atsevišķas SQL piekļuves tiesības';
  $('sqlite-download').classList.toggle('hidden',engine!=='sqlite'||!ready);
  setSaveStatus('● Saglabāts');setResults(null);await refreshTables();renderHistory();
}
async function setEngine(engine){
  if(state.role!=='student')return;if(engine===state.engine&&state.workspace)return;
  if(state.dirty)try{await saveWorkspace({quiet:true});}catch(e){toast('Iepriekšējās izmaiņas nav saglabātas: '+e.message,true);return;}
  state.engine=engine;state.workspace=null;state.sqliteDb=null;
  document.querySelectorAll('.engine-btn').forEach(b=>b.classList.toggle('active',b.dataset.engine===engine));
  $('engine-heading').textContent=ENGINES[engine].title;$('crumb-engine').textContent=ENGINES[engine].title;
  $('engine-description').textContent=ENGINES[engine].desc;
  $('editor-content').classList.add('hidden');$('provision-panel').classList.add('hidden');$('not-configured').classList.add('hidden');
  fillTemplates();try{await refreshWorkspace();}catch(e){toast(e.message,true);}
}
function setResults(result){
  const output=$('query-output');$('result-status').textContent='—';$('run-meta').textContent='Gaida pirmo vaicājumu';
  if(!result){output.innerHTML='<div class="empty-results"><div class="empty-icon">⌁</div><h3>Šeit redzēsi rezultātus</h3><p>Uzraksti SQL vaicājumu un nospied “Izpildīt SQL”.</p></div>';return;}
  if(result.error){output.innerHTML='<div class="error-output">'+escapeHtml(result.error)+'</div>';$('result-status').textContent='Kļūda';$('result-status').style.color='var(--red)';$('run-meta').textContent='Pārbaudi vaicājuma sintaksi un datus';return;}
  $('result-status').style.color='var(--green)';$('result-status').textContent='Izpildīts';$('run-meta').textContent=`${result.rowCount??0} rindas · ${result.elapsedMs||0} ms`;
  if(!result.columns?.length){output.innerHTML='<div class="result-message">✓ Vaicājums izpildīts. '+(result.rowCount??0)+' ietekmētie ieraksti.</div>';return;}
  const cols=result.columns.slice(0,30);const rows=(result.rows||[]).slice(0,150);
  output.innerHTML=`<table class="result-table"><thead><tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>{const v=r?.[c];return `<td class="${v===null?'null-cell':''}" title="${escapeHtml(v===null?'NULL':typeof v==='object'?JSON.stringify(v):String(v??''))}">${escapeHtml(v===null?'NULL':typeof v==='object'?JSON.stringify(v):String(v??''))}</td>`;}).join('')}</tr>`).join('')}</tbody></table>${result.truncated?'<div class="result-message">Parādītas pirmās 150 rindas.</div>':''}`;
}
async function refreshTables(){
  const engine=state.engine;let tables=[];
  try {
    if(engine==='sqlite'&&state.sqliteDb){const raw=state.sqliteDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");tables=raw[0]?.values.map(r=>r[0])||[];}
    else if(state.workspace?.provisioned){tables=(await api('explore',{query:{engine}})).tables||[];}
  }catch(e){$('tables-list').innerHTML=`<div class="side-muted">${escapeHtml(e.message)}</div>`;return;}
  if(engine!==state.engine)return;
  $('tables-list').innerHTML=tables.length?tables.map(t=>`<button class="table-item" data-table="${escapeHtml(t)}"><span>▤ ${escapeHtml(t)}</span><span>↗</span></button>`).join(''):'<div class="side-muted">Tabulu vēl nav. Izveido pirmo!</div>';
  document.querySelectorAll('.table-item').forEach(btn=>btn.addEventListener('click',()=>{
    const t=btn.dataset.table;
    const ident=state.engine==='mysql'?'`'+t.replaceAll('`','``')+'`':'"'+t.replaceAll('"','""')+'"';
    $('sql-editor').value=`SELECT * FROM ${ident} LIMIT 50;`;
    editChanged();
  }));
}
function renderHistory(){
  $('history-list').innerHTML=state.history.length?state.history.map((h,i)=>`<button class="history-item" data-idx="${i}"><code>${escapeHtml(h.statement_preview)}</code><small><span class="${h.success?'good':'bad'}">${h.success?'● Izdevās':'● Kļūda'}</span> · ${new Date(h.created_at).toLocaleString('lv-LV')}</small></button>`).join(''):'<div class="side-muted">Vaicājumu vēl nav</div>';
  document.querySelectorAll('.history-item').forEach(b=>b.addEventListener('click',()=>{$('sql-editor').value=state.history[Number(b.dataset.idx)].statement_preview;editChanged();}));
}
function editChanged(){state.dirty=true;setSaveStatus('● Nesaglabāts');lines();clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>{if(state.role==='student')saveWorkspace({quiet:true}).catch(()=>{})},1600);}
async function saveWorkspace({quiet=false}={}){
  if(state.role!=='student'||!state.workspace)return;
  clearTimeout(state.saveTimer);
  const engine=state.engine,draftSql=$('sql-editor').value;
  const data={engine,draftSql};
  if(engine==='sqlite'&&state.sqliteDb)data.sqliteData=bytesB64(state.sqliteDb.export());
  if(data.sqliteData?.length>1150000)throw new Error('SQLite datubāzes fails pārsniedz 850 KB. Eksportē failu un samazini datu apjomu.');
  setSaveStatus('● Saglabā...');
  await api('save',{method:'POST',data});
  if(engine===state.engine&&draftSql===$('sql-editor').value){state.dirty=false;setSaveStatus('● Saglabāts');}
  if(!quiet)toast('Projekts saglabāts!');
}
async function runSQL(){
  if(state.loading||state.role!=='student')return;
  const engine=state.engine,sql=$('sql-editor').value.trim();if(!sql){toast('Vispirms ieraksti SQL komandu.',true);return;}
  setLoading(true);const start=performance.now();
  try{
    let result;
    if(engine==='sqlite'){
      if(state.sqliteDb)state.sqliteDb.run('PRAGMA foreign_keys=ON;');
      if(!state.sqliteDb)throw new Error('SQLite vēl nav ielādēta.');
      const raw=state.sqliteDb.exec(sql);const last=raw.at(-1);
      result={columns:last?.columns||[],rows:last?last.values.slice(0,150).map(a=>Object.fromEntries(last.columns.map((c,i)=>[c,a[i]]))):[],rowCount:last?.values.length??state.sqliteDb.getRowsModified(),truncated:Boolean(last?.values.length>150),elapsedMs:Math.round(performance.now()-start)};
      state.dirty=true;
      await saveWorkspace({quiet:true});
      api('log-sqlite',{method:'POST',data:{statement:sql,success:true,duration:result.elapsedMs}}).catch(()=>{});
    } else {
      result=await api('run',{method:'POST',data:{engine,sql}});
      await saveWorkspace({quiet:true});
    }
    setResults(result);await refreshTables();
    const h={statement_preview:sql.slice(0,1200),success:true,created_at:new Date().toISOString()};state.history.unshift(h);state.history=state.history.slice(0,12);renderHistory();
  }catch(e){
    const ms=Math.round(performance.now()-start);
    setResults({error:e.message});
    if(engine==='sqlite'){api('log-sqlite',{method:'POST',data:{statement:sql,success:false,duration:ms,error:e.message}}).catch(()=>{});}
    const h={statement_preview:sql.slice(0,1200),success:false,created_at:new Date().toISOString()};state.history.unshift(h);state.history=state.history.slice(0,12);renderHistory();
  }finally{setLoading(false);}
}
async function provision(){const engine=state.engine;try{$('provision-btn').disabled=true;$('provision-btn').textContent='Veido datubāzi...';await api('provision',{method:'POST',data:{engine}});toast('Personīgā datubāze izveidota!');await refreshWorkspace();}catch(e){toast('Neizdevās izveidot: '+e.message,true);}finally{$('provision-btn').disabled=false;$('provision-btn').textContent='+ Izveidot manu datubāzi';}}
function downloadFile(name,content,mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function logout(){try{await api('logout',{method:'POST'});}catch{}location.reload();}
function showAuth(){state.role='guest';$('shell').classList.add('hidden');$('auth').classList.remove('hidden');}
function showShell(){ $('auth').classList.add('hidden');$('shell').classList.remove('hidden');const name=state.role==='teacher'?'Skolotājs':state.user.display_name;
  $('profile-name').textContent=name;$('profile-group').textContent=state.role==='teacher'?'Administrators':state.user.class_group||'Programmēšana';$('avatar').textContent=name.charAt(0).toUpperCase();$('top-avatar').textContent=name.charAt(0).toUpperCase();
  if(state.role==='teacher'){$('student-view').classList.add('hidden');$('teacher-view').classList.remove('hidden');$('sidebar-info').innerHTML='<span>Skolotāja režīms</span>';$('engine-nav').classList.add('hidden');$('teacher-button').classList.add('hidden');loadTeacher().catch(e=>toast(e.message,true));}
  else{$('student-view').classList.remove('hidden');$('teacher-view').classList.add('hidden');$('engine-nav').classList.remove('hidden');document.querySelectorAll('.engine-status').forEach(el=>{const engine=el.id.replace('st-','');el.classList.toggle('connected',state.engines[engine]);});state.workspace=null;setEngine('sqlite');}
}
async function boot(){
  try{const me=await api('me');state.role=me.role;state.engines=me.engines||state.engines;state.user=me.user||null;state.workspaces=me.workspaces||[];if(me.role==='guest')showAuth();else showShell();}
  catch(e){showAuth();toast('Nevar pieslēgties: '+e.message,true);}
}
function teacherStat(name,value){return `<div class="stat"><strong>${value}</strong><span>${name}</span></div>`}
async function loadTeacher(){
  const data=await api('teacher');state.teacherStudents=data.students||[];
  $('stats-row').innerHTML=teacherStat('Reģistrēti skolēni',state.teacherStudents.length)+teacherStat('SQL pieprasījumi',state.teacherStudents.reduce((x,s)=>x+s.query_count,0))+teacherStat('Izveidotas darba vides',state.teacherStudents.reduce((x,s)=>x+s.workspace_count,0));
  $('student-list').innerHTML=state.teacherStudents.length?state.teacherStudents.map(s=>`<button class="student-entry" data-uid="${s.id}"><span class="avatar">${escapeHtml(s.display_name.charAt(0).toUpperCase())}</span><span class="student-text"><strong>${escapeHtml(s.display_name)}</strong><small>${escapeHtml(s.class_group||'—')} · @${escapeHtml(s.username)}</small></span><span class="entry-count">${s.query_count} SQL</span></button>`).join(''):'<div class="side-muted">Vēl nav reģistrētu skolēnu.</div>';
  document.querySelectorAll('.student-entry').forEach(b=>b.addEventListener('click',()=>loadTeacherStudent(b.dataset.uid).catch(e=>toast(e.message,true))));
}
async function loadTeacherStudent(uid){
  const data=await api('teacher-student',{query:{uid}});state.currentStudent=uid;
  document.querySelectorAll('.student-entry').forEach(b=>b.classList.toggle('selected',b.dataset.uid===uid));
  const u=data.student,ws=data.workspaces,logs=data.logs;
  $('student-detail').innerHTML=`<h3>${escapeHtml(u.display_name)}</h3><p class="muted">@${escapeHtml(u.username)} · ${escapeHtml(u.class_group||'Grupa nav norādīta')}</p><h4>Darba vides</h4><div>${ws.length?ws.map(w=>`<span class="chip">${escapeHtml(w.engine)} ${w.engine==='sqlite'||w.provisioned?'✓':'(nav inicializēta)'}</span>`).join(''):'<span class="muted">Vēl nav izveidota neviena darba vide.</span>'}</div><h4>Saglabātais SQL kods</h4>${ws.map(w=>`<details><summary style="cursor:pointer;color:#adbdf4">${escapeHtml(w.engine)} redaktors</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto;font-size:11px;color:#b5c9e5">${escapeHtml(w.draft_sql||'Nav saglabāta koda.')}</pre></details>`).join('')}<h4>SQL aktivitāte (${logs.length} jaunākie ieraksti)</h4>${logs.length?logs.map(l=>`<div class="log-entry ${l.success?'':'error'}"><span class="chip">${escapeHtml(l.engine)}</span><code>${escapeHtml(l.statement_preview)}</code><small>${new Date(l.created_at).toLocaleString('lv-LV')} · ${l.success?'Izpildīts':'Kļūda: '+escapeHtml(l.error_summary||'')}${l.duration_ms?' · '+l.duration_ms+'ms':''}</small></div>`).join(''):'<p class="muted">Pagaidām nav SQL vēstures.</p>'}`;
}
let signup=false;
$('auth-switch').addEventListener('click',()=>{signup=!signup;$('signup-fields').classList.toggle('hidden',!signup);$('auth-title').textContent=signup?'Izveido savu kontu':'Pieslēgties laboratorijai';$('auth-desc').textContent=signup?'Tavs SQL projekts būs saglabāts starp nodarbībām.':'Turpini darbu ar savu datubāzi.';$('auth-submit').innerHTML=signup?'Izveidot kontu <span>→</span>':'Pieslēgties <span>→</span>';$('auth-switch').innerHTML=signup?'Jau ir konts? <strong>Pieslēgties</strong>':'Vēl nav konta? <strong>Izveidot kontu</strong>';});
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),data=Object.fromEntries(fd.entries());const btn=$('auth-submit');btn.disabled=true;try{await api(signup?'signup':'login',{method:'POST',data});await boot();toast(signup?'Konts izveidots!':'Esi pieslēdzies!');}catch(err){toast(err.message,true);}finally{btn.disabled=false;}});
$('engine-nav').addEventListener('click',e=>{const btn=e.target.closest('[data-engine]');if(btn)setEngine(btn.dataset.engine);});
$('sql-editor').addEventListener('input',editChanged);
$('sql-editor').addEventListener('scroll',()=>{$('line-numbers').scrollTop=$('sql-editor').scrollTop;});
$('sql-editor').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const t=e.target,start=t.selectionStart;t.setRangeText('  ',start,t.selectionEnd,'end');editChanged();}if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();runSQL();}});
$('run-sql').addEventListener('click',runSQL);
$('save-workspace').addEventListener('click',()=>saveWorkspace().catch(e=>toast(e.message,true)));
$('refresh-tables').addEventListener('click',()=>refreshTables().catch(e=>toast(e.message,true)));
$('provision-btn').addEventListener('click',provision);
$('template-select').addEventListener('change',e=>{if(e.target.value==='')return;const x=templates[state.engine][Number(e.target.value)];if($('sql-editor').value.trim()&&!confirm('Aizstāt pašreizējo SQL kodu ar piemēru?')){e.target.value='';return;}$('sql-editor').value=x.sql;editChanged();e.target.value='';});
$('clear-editor').addEventListener('click',()=>{if(confirm('Notīrīt SQL redaktoru? Tabulas datubāzē netiks dzēstas.')){$('sql-editor').value='';editChanged();}});
$('export-sql').addEventListener('click',()=>downloadFile(`sqllab-${state.engine}-${new Date().toISOString().slice(0,10)}.sql`,$('sql-editor').value,'text/plain'));
$('sqlite-download').addEventListener('click',()=>{if(state.sqliteDb)downloadFile('mana-datubaze.sqlite',state.sqliteDb.export(),'application/x-sqlite3');});
$('logout').addEventListener('click',logout);
$('teacher-refresh').addEventListener('click',()=>loadTeacher().catch(e=>toast(e.message,true)));
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
boot();
