// ---------- storage ----------
const STORE_KEY = "lifeos_v1";
function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {
    tasks: [],            // {id, text, done, date}
    logs: {},             // date -> {spend, save, mood, notes}
    projects: [
      {id:1, name:"ADAS benchmarking — Urbania (M2)", cat:"work", status:"active", notes:"Competitor + regulatory mapping vs Sprinter, HiAce"},
      {id:2, name:"HVAC electronics — Nissan auto HVAC", cat:"work", status:"active", notes:"CAN control logic, compressor, stepper doors, diagnostics"},
      {id:3, name:"Hardware design learning track", cat:"personal", status:"active", notes:"Personal ramp-up direction"}
    ],
    finance: {income:0, fixed:0, target:20},
    goals: [],             // {id, text, term, done}
    habits: [],            // {id, name, log:{date:true}}
    ideas: [],             // {id, text, ts}
    shopping: [],          // {id, text, cat, done}
    vision: [],            // {id, text, img}
    flashcards: [],        // {id, q, a}
    officeTasks: [],       // {id, text, domain, kind, date, done, note}
    studySessions: [],     // {id, topic, minutes, date}
    gameProgress: {quizUsed:[], scrambleUsed:[], quizLevel:1},
    settings: {reminderTime:null, reminderEnabled:false, lastNotified:null}
  };
}
let DATA = load();
if(!DATA.settings) DATA.settings = {reminderTime:null, reminderEnabled:false, lastNotified:null};
if(!DATA.shopping) DATA.shopping = [];
if(!DATA.vision) DATA.vision = [];
if(!DATA.flashcards) DATA.flashcards = [];
if(!DATA.officeTasks) DATA.officeTasks = [];
DATA.officeTasks.forEach(o=>{
  if(o.dueDate===undefined) o.dueDate = o.date;
  if(o.completedDate===undefined) o.completedDate = o.done ? o.date : null;
  if(o.redoOf===undefined) o.redoOf = null;
});
if(!DATA.gameProgress) DATA.gameProgress = {quizUsed:[], scrambleUsed:[]};
if(DATA.gameProgress.quizLevel===undefined) DATA.gameProgress.quizLevel = 1;
if(!DATA.studySessions) DATA.studySessions = [];

// ---------- unified Habits + Tasks model ----------
if(!DATA.allTasks) DATA.allTasks = [];
if(!DATA.allHabits) DATA.allHabits = [];
if(!DATA.migratedV2){
  // pull personal tasks in as category "Personal"
  DATA.tasks.forEach(t=>{
    DATA.allTasks.push({
      id: 'p'+t.id, title:t.text, category: t.kind==='learning' ? 'Learning' : 'Personal',
      status: t.done ? 'closed':'open', dueDate: t.date, createdDate: t.date,
      completedDate: t.done ? t.date : null, note: t.note||'', redoOf:null, domain:null
    });
  });
  // pull office tasks in as category "Office"
  DATA.officeTasks.forEach(o=>{
    DATA.allTasks.push({
      id: 'o'+o.id, title:o.text, category: o.kind==='learning' ? 'Learning' : 'Office',
      status: o.done ? 'closed':'open', dueDate:o.dueDate||o.date, createdDate:o.date,
      completedDate:o.completedDate||null, note:o.note||'', redoOf:o.redoOf?('o'+o.redoOf):null, domain:o.domain
    });
  });
  // pull shopping items in as category "Shopping"
  DATA.shopping.forEach(s=>{
    DATA.allTasks.push({
      id: 's'+s.id, title:s.text, category:'Shopping',
      status: s.done ? 'closed':'open', dueDate:null, createdDate: todayStr(),
      completedDate: s.done ? todayStr() : null, note:'', redoOf:null, domain:s.cat||null
    });
  });
  // pull habits in, defaulting category/frequency since old habits had neither
  DATA.habits.forEach(h=>{
    DATA.allHabits.push({
      id: 'h'+h.id, name:h.name, category:'General', frequency:'daily', log: h.log||{}
    });
  });
  DATA.migratedV2 = true;
}

let driveSaveTimer=null, tokenClient=null, accessToken=null;
function persist(){
  DATA.updatedAt = Date.now();
  localStorage.setItem(STORE_KEY, JSON.stringify(DATA));
  if(accessToken){ clearTimeout(driveSaveTimer); driveSaveTimer=setTimeout(driveSave, 1200); }
}

// ---------- Google Drive sync (appDataFolder — private, hidden file, one JSON) ----------
async function driveEnsureFileId(){
  let id = localStorage.getItem('lifeos_drive_file_id');
  if(id) return id;
  const searchResp = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27lifeos_data.json%27&fields=files(id,name)", {headers:{Authorization:'Bearer '+accessToken}});
  const searchData = await searchResp.json();
  if(searchData.files && searchData.files.length){
    id = searchData.files[0].id;
    localStorage.setItem('lifeos_drive_file_id', id);
    return id;
  }
  const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method:'POST',
    headers:{Authorization:'Bearer '+accessToken, 'Content-Type':'application/json'},
    body: JSON.stringify({name:'lifeos_data.json', parents:['appDataFolder']})
  });
  const createData = await createResp.json();
  id = createData.id;
  localStorage.setItem('lifeos_drive_file_id', id);
  return id;
}
async function driveSave(){
  if(!accessToken) return;
  const statusEl = document.getElementById('driveStatus');
  try{
    const id = await driveEnsureFileId();
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method:'PATCH',
      headers:{Authorization:'Bearer '+accessToken, 'Content-Type':'application/json'},
      body: JSON.stringify(DATA)
    });
    if(statusEl) statusEl.textContent = 'Synced ✓ ' + new Date().toLocaleTimeString();
  }catch(e){ if(statusEl) statusEl.textContent = 'Sync failed — click Connect Drive again'; }
}
async function driveLoad(){
  if(!accessToken) return;
  try{
    const id = await driveEnsureFileId();
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {headers:{Authorization:'Bearer '+accessToken}});
    if(resp.ok){
      const text = await resp.text();
      if(text && text.trim().length>2){
        const remote = JSON.parse(text);
        if(!remote.settings) remote.settings = {reminderTime:null, reminderEnabled:false, lastNotified:null};
        if(!remote.shopping) remote.shopping = [];
        if(!remote.vision) remote.vision = [];
        if(!remote.flashcards) remote.flashcards = [];
        if(!remote.officeTasks) remote.officeTasks = [];
        remote.officeTasks.forEach(o=>{
          if(o.dueDate===undefined) o.dueDate = o.date;
          if(o.completedDate===undefined) o.completedDate = o.done ? o.date : null;
          if(o.redoOf===undefined) o.redoOf = null;
        });
        if(!remote.gameProgress) remote.gameProgress = {quizUsed:[], scrambleUsed:[]};
        if(remote.gameProgress.quizLevel===undefined) remote.gameProgress.quizLevel = 1;
        // merge — never let a Drive pull erase no-repeat progress tracked locally this session
        const localQuizUsed = (typeof quizUsed!=='undefined') ? [...quizUsed] : [];
        const localScrambleUsed = (typeof scrambleUsed!=='undefined') ? [...scrambleUsed] : [];
        const mergedQuiz = new Set([...(remote.gameProgress.quizUsed||[]), ...localQuizUsed]);
        const mergedScramble = new Set([...(remote.gameProgress.scrambleUsed||[]), ...localScrambleUsed]);
        remote.gameProgress.quizUsed = [...mergedQuiz];
        remote.gameProgress.scrambleUsed = [...mergedScramble];
        if(!remote.studySessions) remote.studySessions = [];
        if(!remote.allTasks) remote.allTasks = [];
        if(!remote.allHabits) remote.allHabits = [];
        if(!remote.goals) remote.goals = [];
        if(DATA.updatedAt && remote.updatedAt && remote.updatedAt < DATA.updatedAt){
          driveSave();   // local copy is newer — push it up instead of overwriting it
          return;
        }
        DATA = remote;
        quizUsed = mergedQuiz;
        scrambleUsed = mergedScramble;
        localStorage.setItem(STORE_KEY, JSON.stringify(DATA));
        renderAll(); loadTodayFields(); loadFinanceFields();
        toast('Loaded from Drive');
      }
    }
  }catch(e){}
}
function connectDrive(){
  const clientId = document.getElementById('gClientId').value.trim();
  if(!clientId){ toast('Paste your Google Client ID first'); return; }
  localStorage.setItem('lifeos_gcid', clientId);
  if(!window.google || !google.accounts){ toast('Google script not loaded — check your internet connection'); return; }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    callback: async (resp)=>{
      if(resp.error){ toast('Sign-in failed'); return; }
      accessToken = resp.access_token;
      document.getElementById('driveStatus').textContent = 'Connected — loading...';
      await driveLoad();
      await driveSave();
      document.getElementById('driveStatus').textContent = 'Connected ✓ auto-syncing';
    }
  });
  tokenClient.requestAccessToken();
}
function attemptSilentConnect(){
  const clientId = localStorage.getItem('lifeos_gcid');
  if(!clientId) return;
  if(!window.google || !google.accounts){ setTimeout(attemptSilentConnect, 600); return; }
  const statusEl = document.getElementById('driveStatus');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    callback: async (resp)=>{
      if(resp.error){
        if(statusEl) statusEl.textContent = 'Not connected — tap Connect Drive once';
        return;
      }
      accessToken = resp.access_token;
      if(statusEl) statusEl.textContent = 'Connected — loading...';
      await driveLoad();
      if(statusEl) statusEl.textContent = 'Connected ✓ auto-syncing';
    }
  });
  tokenClient.requestAccessToken({prompt:''});
}
setInterval(()=>{
  if(accessToken && !driveSaveTimer){ driveLoad(); }
}, 45000);
window.addEventListener('beforeunload', ()=>{
  if(driveSaveTimer){ clearTimeout(driveSaveTimer); driveSave(); }
});
function todayStr(){ return new Date().toISOString().slice(0,10); }
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1400);
}
function uid(){ return Date.now() + Math.floor(Math.random()*1000); }

// ---------- mascot reactions ----------
let mascotTimer = null;
const pokeLines = ["Doing alright?","One thing at a time.","I'm here if you need a break.","You've got this.","Small steps still count."];
function mascotReact(mood, text, duration){
  duration = duration || 2200;
  const m = document.getElementById('mascot');
  const b = document.getElementById('mascotBubble');
  if(!m || !b) return;
  m.classList.remove('mood-cheer','mood-worried');
  if(mood==='cheer') m.classList.add('mood-cheer');
  if(mood==='worried') m.classList.add('mood-worried');
  m.classList.remove('bounce'); void m.offsetWidth; m.classList.add('bounce');
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(mascotTimer);
  mascotTimer = setTimeout(()=>{
    b.classList.remove('show');
    m.classList.remove('mood-cheer','mood-worried');
  }, duration);
}
function mascotPoke(){
  mascotReact('happy', pokeLines[Math.floor(Math.random()*pokeLines.length)]);
}

// ---------- mascot wandering ----------
function mascotWander(){
  const wrap = document.querySelector('.mascot-wrap');
  const cat = document.getElementById('mascot');
  if(!wrap || !cat) return;
  const maxRight = Math.max(20, window.innerWidth - 100);
  const newRight = Math.floor(Math.random()*maxRight);
  cat.classList.add('walking');
  wrap.style.right = newRight+'px';
  setTimeout(()=>{ cat.classList.remove('walking'); }, 3500);
}
setInterval(mascotWander, 14000);

// ---------- nav ----------
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    const view = document.getElementById('view-'+tab.dataset.view);
    view.classList.add('active');
    renderAll();
    animateTitle(view.querySelector('.title'));
    closeNav();
  });
});

// ---------- slide-out drawer ----------
function toggleNav(){
  document.getElementById('navRail').classList.toggle('open');
  document.getElementById('navBackdrop').classList.toggle('show');
  document.getElementById('hamburger').classList.toggle('open');
}
function closeNav(){
  document.getElementById('navRail').classList.remove('open');
  document.getElementById('navBackdrop').classList.remove('show');
  document.getElementById('hamburger').classList.remove('open');
}

// ---------- letter-by-letter title reveal ----------
function animateTitle(el){
  if(!el) return;
  const text = el.dataset.text || el.textContent;
  el.dataset.text = text;
  el.innerHTML = '';
  [...text].forEach((ch, i)=>{
    const span = document.createElement('span');
    span.className = 'letter';
    span.style.animationDelay = (i*0.028)+'s';
    span.textContent = ch === ' ' ? '\u00A0' : ch;
    el.appendChild(span);
  });
}

// ---------- button ripple feedback ----------
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height);
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size+'px';
  ripple.style.left = (e.clientX - rect.left - size/2)+'px';
  ripple.style.top = (e.clientY - rect.top - size/2)+'px';
  btn.appendChild(ripple);
  setTimeout(()=>ripple.remove(), 550);
});

// (card tilt is now pure CSS — see .card:hover in style.css — removed the mousemove tracking that was tanking performance)

// ---------- confetti burst ----------
function confettiBurst(){
  const colors = ['#4fb8a6','#e0a458','#e08a63','#9b7fb0'];
  for(let i=0;i<26;i++){
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = (42+Math.random()*16)+'vw';
    p.style.background = colors[Math.floor(Math.random()*colors.length)];
    p.style.borderRadius = Math.random()>0.5 ? '50%' : '2px';
    p.style.setProperty('--x', Math.round(Math.random()*260-130)+'px');
    p.style.setProperty('--r', Math.round(Math.random()*360)+'deg');
    p.style.setProperty('--dur', (0.9+Math.random()*0.7)+'s');
    document.body.appendChild(p);
    setTimeout(()=>p.remove(), 1800);
  }
}

// ---------- number count-up ----------
function countUpEl(el, targetText){
  if(!el) return;
  const target = parseInt(targetText, 10);
  const prevRaw = el.textContent;
  if(isNaN(target)){ el.textContent = targetText; return; }
  const prev = parseInt(prevRaw, 10);
  if(isNaN(prev) || prev===target){ el.textContent = targetText; if(prev!==target){ el.classList.remove('num-pop'); void el.offsetWidth; el.classList.add('num-pop'); } return; }
  const steps = 12, diff = target - prev;
  let i = 0;
  const iv = setInterval(()=>{
    i++;
    el.textContent = Math.round(prev + (diff*i/steps));
    if(i>=steps){ clearInterval(iv); el.textContent = target; }
  }, 25);
}

// ---------- TODAY: tasks ----------
function addTask(){
  const inp = document.getElementById('taskInput');
  const text = inp.value.trim();
  if(!text) return;
  const d = todayStr();
  const dup = DATA.tasks.some(t=>t.date===d && t.text.toLowerCase()===text.toLowerCase());
  if(dup){ toast('Already on today\'s list'); return; }
  DATA.tasks.push({id:uid(), text, done:false, date:d, kind:document.getElementById('taskKind').value, note:''});
  inp.value=''; persist(); renderTasks();
}
function toggleTask(id){
  const t = DATA.tasks.find(x=>x.id===id);
  if(t){
    t.done=!t.done; persist(); renderTasks();
    if(t.done){
      const stillOpen = relevantTasks().filter(x=>!x.done).length;
      mascotReact('cheer', stillOpen===0 ? 'All clear today!' : 'Nice, one down.');
      if(stillOpen===0) confettiBurst();
    }
  }
}
function addTaskNote(id){
  const t = DATA.tasks.find(x=>x.id===id);
  if(!t) return;
  const note = prompt('Why is this still open? (e.g. blocked, redoing tomorrow)', t.note||'');
  if(note!==null){ t.note = note.trim(); persist(); renderTasks(); }
}
function delTask(id){
  DATA.tasks = DATA.tasks.filter(x=>x.id!==id); persist(); renderTasks();
}
function relevantTasks(){
  // today's own tasks, plus anything still undone from earlier days — carried forward, never lost
  const d = todayStr();
  return DATA.tasks.filter(t=> t.date===d || !t.done);
}
function renderTasks(){
  const list = document.getElementById('taskList');
  const d = todayStr();
  const items = relevantTasks();
  list.innerHTML = items.map(t=>`
    <li class="${t.done?'done':''}">
      <input type="checkbox" ${t.done?'checked':''} onchange="toggleTask(${t.id})">
      <span class="txt">${escapeHtml(t.text)}
        <span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${t.kind==='learning'?'· learning':''}</span>
        ${t.note ? `<div style="font-size:11px;color:var(--amber); margin-top:2px;">↳ ${escapeHtml(t.note)}</div>` : ''}
      </span>
      ${t.date!==d ? `<span style="font-size:10px;color:var(--amber);font-family:var(--mono);">from ${t.date}</span>` : ''}
      ${!t.done ? `<span class="del" onclick="addTaskNote(${t.id})" title="add reason" style="color:var(--muted);">✎</span>` : ''}
      <span class="del" onclick="delTask(${t.id})">✕</span>
    </li>`).join('') || '<li class="empty" style="border:none;">No tasks added for today yet.</li>';
}

// ---------- TODAY: save entry ----------
function saveToday(){
  const d = todayStr();
  DATA.logs[d] = {
    spend: parseFloat(document.getElementById('spendInput').value)||0,
    save: parseFloat(document.getElementById('saveInput').value)||0,
    sleep: parseFloat(document.getElementById('sleepInput').value)||null,
    mood: parseInt(document.getElementById('moodInput').value)||null,
    notes: document.getElementById('notesInput').value||''
  };
  // mark today's habits checked state is handled separately via toggleHabitToday
  persist();
  toast('Today logged ✓');
  mascotReact('cheer', 'Today\'s locked in.');
  renderHistory(); renderFinance();
}
function loadTodayFields(){
  const d = todayStr();
  const l = DATA.logs[d];
  if(l){
    document.getElementById('spendInput').value = l.spend || '';
    document.getElementById('saveInput').value = l.save || '';
    document.getElementById('sleepInput').value = l.sleep || '';
    document.getElementById('moodInput').value = l.mood || '';
    document.getElementById('notesInput').value = l.notes || '';
  }
}

// ---------- HISTORY ----------
function renderHistory(){
  const body = document.getElementById('historyBody');
  const dates = Object.keys(DATA.logs).sort().reverse();
  document.getElementById('historyEmpty').style.display = dates.length? 'none':'block';
  body.innerHTML = dates.map(d=>{
    const l = DATA.logs[d];
    return `<tr><td>${d}</td><td>₹${l.spend||0}</td><td>₹${l.save||0}</td><td>${l.mood||'—'}</td><td style="font-family:var(--sans); max-width:340px;">${escapeHtml(l.notes||'')}</td></tr>`;
  }).join('');
}

// ---------- PROJECTS ----------
function addProject(){
  const name = document.getElementById('projName').value.trim();
  if(!name) return;
  DATA.projects.push({id:uid(), name, cat:document.getElementById('projCat').value, status:'active', notes:''});
  document.getElementById('projName').value='';
  persist(); renderProjects();
}
function updateProjStatus(id, status){
  const p = DATA.projects.find(x=>x.id===id); if(p){ p.status=status; persist(); renderProjects(); }
}
function updateProjNotes(id, notes){
  const p = DATA.projects.find(x=>x.id===id); if(p){ p.notes=notes; persist(); }
}
function delProject(id){
  DATA.projects = DATA.projects.filter(x=>x.id!==id); persist(); renderProjects();
}
function renderProjects(){
  const el = document.getElementById('projectList');
  document.getElementById('projectEmpty').style.display = DATA.projects.length? 'none':'block';
  el.innerHTML = DATA.projects.map(p=>`
    <div class="proj">
      <div class="top">
        <div>
          <span class="name">${escapeHtml(p.name)}</span>
          <span class="pill ${p.cat}" style="margin-left:8px;">${p.cat}</span>
        </div>
        <div class="row" style="flex:0 0 auto; gap:6px;">
          <select onchange="updateProjStatus(${p.id}, this.value)">
            <option value="active" ${p.status==='active'?'selected':''}>Active</option>
            <option value="paused" ${p.status==='paused'?'selected':''}>Paused</option>
            <option value="done" ${p.status==='done'?'selected':''}>Done</option>
          </select>
          <span class="del" style="cursor:pointer;color:var(--muted);" onclick="delProject(${p.id})">✕</span>
        </div>
      </div>
      <textarea style="margin-top:8px;min-height:38px;" onblur="updateProjNotes(${p.id}, this.value)" placeholder="Notes...">${escapeHtml(p.notes||'')}</textarea>
    </div>
  `).join('');
}

// ---------- FINANCE ----------
function saveFinance(){
  DATA.finance = {
    income: parseFloat(document.getElementById('incomeInput').value)||0,
    fixed: parseFloat(document.getElementById('fixedInput').value)||0,
    target: parseFloat(document.getElementById('targetInput').value)||20
  };
  persist(); toast('Baseline saved'); renderFinance();
}
function loadFinanceFields(){
  document.getElementById('incomeInput').value = DATA.finance.income||'';
  document.getElementById('fixedInput').value = DATA.finance.fixed||'';
  document.getElementById('targetInput').value = DATA.finance.target||20;
}
function renderFinance(){
  const now = new Date();
  const monthPrefix = now.toISOString().slice(0,7);
  const monthDates = Object.keys(DATA.logs).filter(d=>d.startsWith(monthPrefix));
  let spend=0, save=0;
  monthDates.forEach(d=>{ spend += DATA.logs[d].spend||0; save += DATA.logs[d].save||0; });
  document.getElementById('mSpend').textContent = '₹'+spend;
  document.getElementById('mSave').textContent = '₹'+save;
  const income = DATA.finance.income||0;
  const pct = income>0 ? Math.round((save/income)*100) : (save>0? 100:0);
  document.getElementById('savingsPct').textContent = income>0 ? pct+'%' : '—';
  const ring = document.getElementById('savingsRing');
  const target = DATA.finance.target||20;
  const color = pct>=target ? '#4fb8a6' : '#e0a458';
  ring.style.background = `conic-gradient(${color} ${Math.min(pct,100)}%, #20272f 0)`;

  // last 14 days bars
  const days = [];
  for(let i=13;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    days.push(d.toISOString().slice(0,10));
  }
  const maxVal = Math.max(1, ...days.map(d=> Math.max((DATA.logs[d]?.spend||0),(DATA.logs[d]?.save||0)) ));
  const barsEl = document.getElementById('financeBars');
  const anyData = days.some(d=>DATA.logs[d]);
  document.getElementById('financeEmpty').style.display = anyData? 'none':'block';
  barsEl.innerHTML = days.map(d=>{
    const l = DATA.logs[d]||{spend:0,save:0};
    return `<div class="bar-row">
      <div class="bar-label">${d.slice(5)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(l.spend/maxVal)*100}%; background:var(--red);"></div></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(l.save/maxVal)*100}%; background:var(--teal);"></div></div>
    </div>`;
  }).join('');
}

// ---------- GOALS ----------
function addGoal(){
  const inp = document.getElementById('goalInput');
  if(!inp.value.trim()) return;
  DATA.goals.push({id:uid(), text:inp.value.trim(), term:document.getElementById('goalTerm').value, done:false});
  inp.value=''; persist(); renderGoals();
}
function toggleGoal(id){
  const g = DATA.goals.find(x=>x.id===id);
  if(g){
    g.done=!g.done; persist(); renderGoals();
    if(g.done){ mascotReact('cheer', 'Goal achieved 🎉', 2800); confettiBurst(); }
  }
}
function delGoal(id){ DATA.goals = DATA.goals.filter(x=>x.id!==id); persist(); renderGoals(); }
function renderGoals(){
  ['daily','weekly','yearly','lifelong'].forEach(term=>{
    const el = document.getElementById('goal-'+term);
    const items = DATA.goals.filter(g=>g.term===term && !g.done);
    el.innerHTML = items.map(g=>`
      <li>
        <input type="checkbox" onchange="toggleGoal(${g.id})">
        <span class="txt">${escapeHtml(g.text)}</span>
        <span class="del" onclick="delGoal(${g.id})">✕</span>
      </li>`).join('') || '<li class="empty" style="border:none; padding:4px 0;">—</li>';
  });
  const ach = document.getElementById('achieveList');
  const done = DATA.goals.filter(g=>g.done);
  document.getElementById('achieveEmpty').style.display = done.length? 'none':'block';
  ach.innerHTML = done.map(g=>`
    <li class="done">
      <span class="pill done">${g.term}</span>
      <span class="txt">${escapeHtml(g.text)}</span>
      <span class="del" onclick="delGoal(${g.id})">✕</span>
    </li>`).join('');
}

// ---------- HABITS ----------
// ---------- HABITS (unified: category, frequency, streak, at-risk) ----------
function habitAppliesToday(h){
  const day = new Date().getDay(); // 0=Sun..6=Sat
  if(h.frequency==='weekends') return day===0 || day===6;
  if(h.frequency==='weekdays') return day>=1 && day<=5;
  return true; // daily
}
function habitLastDueDate(h, fromDate){
  // walk backwards from fromDate (inclusive) to find the most recent date this habit was due
  let d = fromDate ? new Date(fromDate) : new Date();
  for(let i=0;i<14;i++){
    const day = d.getDay();
    const applies = h.frequency==='weekends' ? (day===0||day===6) : h.frequency==='weekdays' ? (day>=1&&day<=5) : true;
    if(applies) return d.toISOString().slice(0,10);
    d.setDate(d.getDate()-1);
  }
  return todayStr();
}
function habitStreak(h){
  let streak=0;
  let d = new Date();
  for(let i=0;i<365;i++){
    const day = d.getDay();
    const applies = h.frequency==='weekends' ? (day===0||day===6) : h.frequency==='weekdays' ? (day>=1&&day<=5) : true;
    if(applies){
      const key = d.toISOString().slice(0,10);
      if(h.log[key]) streak++; else break;
    }
    d.setDate(d.getDate()-1);
  }
  return streak;
}
function habitAtRisk(h){
  const lastDue = habitLastDueDate(h, new Date(Date.now()-86400000)); // most recent due day before today
  return !h.log[lastDue];
}
function addHabit(){
  const inp = document.getElementById('habitInput');
  if(!inp.value.trim()) return;
  DATA.allHabits.push({
    id:uid(), name:inp.value.trim(),
    category: document.getElementById('habitCategory').value,
    frequency: document.getElementById('habitFrequency').value,
    log:{}
  });
  inp.value=''; persist(); renderHabits();
}
function delHabit(id){ DATA.allHabits = DATA.allHabits.filter(x=>x.id!==id); persist(); renderHabits(); }
function toggleHabitToday(id){
  const h = DATA.allHabits.find(x=>x.id===id); if(!h) return;
  const d = todayStr();
  h.log[d] = !h.log[d];
  persist(); renderHabits();
  if(h.log[d]) mascotReact('cheer', habitStreak(h)>2 ? `${habitStreak(h)} days running!` : 'Keep it up.');
}
function renderHabits(){
  const cats = [...new Set(DATA.allHabits.map(h=>h.category))];
  const container = document.getElementById('habitsByCategory');
  document.getElementById('habitsEmpty').style.display = DATA.allHabits.length? 'none':'block';
  if(container){
    container.innerHTML = cats.map(cat=>{
      const items = DATA.allHabits.filter(h=>h.category===cat);
      return `<div class="card" style="margin-bottom:14px;">
        <h3>${escapeHtml(cat)}</h3>
        ${items.map(h=>{
          const risk = habitAtRisk(h);
          return `<div class="proj">
            <div class="top">
              <div>
                <span class="name">${escapeHtml(h.name)}</span>
                <span class="pill ${risk?'paused':'active'}" style="margin-left:8px;">${risk?'At risk':'On track'}</span>
                <span class="streak" style="margin-left:8px;">${habitStreak(h)} day streak</span>
                <div style="font-size:10.5px;color:var(--muted); margin-top:3px;">${h.frequency}</div>
              </div>
              <div class="row" style="flex:0 0 auto; gap:6px;">
                <input type="checkbox" ${h.log[todayStr()]?'checked':''} onchange="toggleHabitToday(${h.id})" title="mark today done">
                <span class="del" style="cursor:pointer;color:var(--muted);" onclick="delHabit(${h.id})">✕</span>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  }
}

// ---------- TASKS (unified: personal + office + shopping, by status) ----------
function addUnifiedTask(){
  const title = document.getElementById('taskTitleInput').value.trim();
  if(!title) return;
  const category = document.getElementById('taskCategoryInput').value.trim() || 'Personal';
  const due = document.getElementById('taskDueInput').value;
  const d = todayStr();
  DATA.allTasks.push({
    id:uid(), title, category, status:'open', dueDate: due||null,
    createdDate:d, completedDate:null, note:'', redoOf:null, domain:null
  });
  document.getElementById('taskTitleInput').value='';
  document.getElementById('taskCategoryInput').value='';
  document.getElementById('taskDueInput').value='';
  persist(); renderTasksView(); renderSnapshot();
  mascotReact('happy','Added.');
}
function setTaskStatus(id, status){
  const t = DATA.allTasks.find(x=>x.id===id);
  if(t){
    t.status = status;
    t.completedDate = status==='closed' ? todayStr() : null;
    persist(); renderTasksView(); renderSnapshot();
    if(status==='closed'){ mascotReact('cheer','Closed out.'); confettiBurst(); }
  }
}
function addTaskComment(id){
  const t = DATA.allTasks.find(x=>x.id===id);
  if(!t) return;
  const note = prompt('Comment (e.g. why it\'s stuck, or what happened)', t.note||'');
  if(note!==null){ t.note = note.trim(); persist(); renderTasksView(); }
}
function delUnifiedTask(id){ DATA.allTasks = DATA.allTasks.filter(x=>x.id!==id); persist(); renderTasksView(); renderSnapshot(); }
function taskRow(t){
  return `<li>
    <span class="txt">${escapeHtml(t.title)}
      <span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${escapeHtml(t.category)}${t.dueDate?' · due '+t.dueDate:''}</span>
      ${t.note ? `<div style="font-size:11px;color:var(--amber); margin-top:2px;">↳ ${escapeHtml(t.note)}</div>` : ''}
    </span>
    <select onchange="setTaskStatus(${t.id}, this.value)" style="flex:0 0 auto; font-size:11px; padding:4px 6px;">
      <option value="open" ${t.status==='open'?'selected':''}>Open</option>
      <option value="in-progress" ${t.status==='in-progress'?'selected':''}>In progress</option>
      <option value="closed" ${t.status==='closed'?'selected':''}>Closed</option>
    </select>
    <span class="del" onclick="addTaskComment(${t.id})" title="comment" style="color:var(--muted);">✎</span>
    <span class="del" onclick="delUnifiedTask(${t.id})">✕</span>
  </li>`;
}
function renderTasksView(){
  const filterSel = document.getElementById('taskCategoryFilter');
  if(filterSel){
    const prevVal = filterSel.value;
    const cats = [...new Set(DATA.allTasks.map(t=>t.category))].sort();
    filterSel.innerHTML = '<option value="">All categories</option>' + cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if(cats.includes(prevVal)) filterSel.value = prevVal;
  }
  const filterVal = filterSel ? filterSel.value : '';
  const filtered = filterVal ? DATA.allTasks.filter(t=>t.category===filterVal) : DATA.allTasks;

  const open = filtered.filter(t=>t.status==='open');
  const inProgress = filtered.filter(t=>t.status==='in-progress');
  const closed = filtered.filter(t=>t.status==='closed');

  document.getElementById('tasksOpenEmpty').style.display = open.length? 'none':'block';
  document.getElementById('tasksOpenList').innerHTML = open.map(taskRow).join('');
  document.getElementById('tasksProgressEmpty').style.display = inProgress.length? 'none':'block';
  document.getElementById('tasksProgressList').innerHTML = inProgress.map(taskRow).join('');
  document.getElementById('tasksClosedEmpty').style.display = closed.length? 'none':'block';
  document.getElementById('tasksClosedList').innerHTML = closed.slice(-30).reverse().map(taskRow).join('');
}

// ---------- IDEAS ----------
function addIdea(){
  const inp = document.getElementById('ideaInput');
  if(!inp.value.trim()) return;
  DATA.ideas.unshift({id:uid(), text:inp.value.trim(), ts:new Date().toLocaleString()});
  inp.value=''; persist(); renderIdeas();
}
function delIdea(id){ DATA.ideas = DATA.ideas.filter(x=>x.id!==id); persist(); renderIdeas(); }
function renderIdeas(){
  const el = document.getElementById('ideaList');
  document.getElementById('ideaEmpty').style.display = DATA.ideas.length? 'none':'block';
  el.innerHTML = DATA.ideas.map(i=>`
    <div class="idea">
      <div class="ts">${i.ts} <span class="del" style="cursor:pointer; float:right;" onclick="delIdea(${i.id})">✕</span></div>
      <div>${escapeHtml(i.text)}</div>
    </div>`).join('');
}

// ---------- utils ----------
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- SNAPSHOT ----------
function renderSnapshot(){
  document.getElementById('snapDate').textContent = new Date().toDateString();

  const openTasks = DATA.allTasks.filter(t=>t.status!=='closed');
  countUpEl(document.getElementById('snapOpenCount'), openTasks.length);

  const atRisk = DATA.allHabits.filter(h=>habitAtRisk(h));
  countUpEl(document.getElementById('snapHabitRisk'), atRisk.length);
  if(atRisk.length>0){
    mascotReact('worried', `${atRisk.length} habit${atRisk.length>1?'s':''} at risk.`, 2600);
  }

  const dueToday = DATA.allHabits.filter(h=>habitAppliesToday(h));
  const todayKey = todayStr();
  document.getElementById('snapHabitsTodayEmpty').style.display = dueToday.length? 'none':'block';
  document.getElementById('snapHabitsToday').innerHTML = dueToday.map(h=>`
    <li class="${h.log[todayKey]?'done':''}">
      <input type="checkbox" ${h.log[todayKey]?'checked':''} onchange="toggleHabitToday(${h.id})">
      <span class="txt">${escapeHtml(h.name)}</span>
      <span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${escapeHtml(h.category)}</span>
    </li>`).join('');

  document.getElementById('reminderTime').value = DATA.settings.reminderTime || '';
  document.getElementById('reminderStatus').textContent = DATA.settings.reminderEnabled
    ? `on · daily at ${DATA.settings.reminderTime}` : '';
}

// ---------- reminder (foreground-only, browser Notification API) ----------
function enableReminder(){
  const val = document.getElementById('reminderTime').value.trim();
  if(!/^\d{1,2}:\d{2}$/.test(val)){ toast('Use HH:MM, e.g. 20:00'); return; }
  if(!('Notification' in window)){ toast('Notifications not supported in this browser'); return; }
  Notification.requestPermission().then(perm=>{
    if(perm==='granted'){
      DATA.settings.reminderTime = val;
      DATA.settings.reminderEnabled = true;
      persist();
      toast('Nudge set for '+val);
      renderSnapshot();
    } else {
      toast('Notification permission was not granted');
    }
  });
}
function checkReminder(){
  if(!DATA.settings.reminderEnabled || !DATA.settings.reminderTime) return;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const d = todayStr();
  if(hhmm===DATA.settings.reminderTime && DATA.settings.lastNotified!==d){
    const open = relevantTasks().filter(t=>!t.done).length;
    if(Notification.permission==='granted'){
      new Notification('Logbook check-in', {
        body: open>0 ? `${open} thing(s) still open today.` : 'All clear — take a minute to log today anyway.'
      });
    }
    DATA.settings.lastNotified = d;
    persist();
  }
}
setInterval(checkReminder, 20000);

// ---------- SHOPPING ----------
function addShopItem(){
  const inp = document.getElementById('shopInput');
  if(!inp.value.trim()) return;
  const text = inp.value.trim();
  const cat = document.getElementById('shopCat').value;
  const newId = uid();
  DATA.shopping.push({id:newId, text, cat, done:false});
  DATA.allTasks.push({
    id:'s'+newId, title:text, category:'Shopping', status:'open', dueDate:null,
    createdDate:todayStr(), completedDate:null, note:'', redoOf:null, domain:cat
  });
  inp.value=''; persist(); renderShopping(); renderTasksView(); renderSnapshot();
}
function toggleShop(id){
  const s=DATA.shopping.find(x=>x.id===id);
  if(s){
    s.done=!s.done;
    const t = DATA.allTasks.find(x=>x.id==='s'+id);
    if(t){ t.status = s.done?'closed':'open'; t.completedDate = s.done?todayStr():null; }
    persist(); renderShopping(); renderTasksView(); renderSnapshot();
  }
}
function delShop(id){
  DATA.shopping = DATA.shopping.filter(x=>x.id!==id);
  DATA.allTasks = DATA.allTasks.filter(x=>x.id!==('s'+id));
  persist(); renderShopping(); renderTasksView(); renderSnapshot();
}
function clearCheckedShop(){
  const doneIds = DATA.shopping.filter(x=>x.done).map(x=>x.id);
  DATA.shopping = DATA.shopping.filter(x=>!x.done);
  DATA.allTasks = DATA.allTasks.filter(x=> !doneIds.includes(parseInt(x.id.slice(1))) || x.id[0]!=='s');
  persist(); renderShopping(); renderTasksView();
}
function renderShopping(){
  const list = document.getElementById('shopList');
  document.getElementById('shopEmpty').style.display = DATA.shopping.length? 'none':'block';
  list.innerHTML = DATA.shopping.map(s=>`
    <li class="${s.done?'done':''}">
      <input type="checkbox" ${s.done?'checked':''} onchange="toggleShop(${s.id})">
      <span class="txt">${escapeHtml(s.text)}</span>
      <span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${s.cat}</span>
      <span class="del" onclick="delShop(${s.id})">✕</span>
    </li>`).join('');
  const cats = ['Groceries','Household','Clothes','Other'];
  const byCat = document.getElementById('shopByCat');
  byCat.innerHTML = cats.map(c=>{
    const items = DATA.shopping.filter(s=>s.cat===c && !s.done);
    if(!items.length) return '';
    return `<div class="cat-block"><h4>${c} (${items.length})</h4>
      <div style="font-size:13px; color:var(--text);">${items.map(i=>escapeHtml(i.text)).join(' · ')}</div></div>`;
  }).join('') || '<div class="empty">Nothing pending.</div>';
}

// ---------- VISION BOARD ----------
const visionColors = ['linear-gradient(135deg, rgba(79,184,166,.22), rgba(79,184,166,.05))',
  'linear-gradient(135deg, rgba(224,164,88,.22), rgba(224,164,88,.05))',
  'linear-gradient(135deg, rgba(224,138,99,.22), rgba(224,138,99,.05))',
  'linear-gradient(135deg, rgba(155,127,176,.22), rgba(155,127,176,.05))'];
function addVisionItem(){
  const text = document.getElementById('visionText').value.trim();
  const imgUrl = document.getElementById('visionImg').value.trim();
  const fileInput = document.getElementById('visionFile');
  const file = fileInput.files && fileInput.files[0];
  if(!text && !imgUrl && !file) return;
  if(file){
    resizeImageFile(file, 900, 0.72, (dataUrl)=>{
      DATA.vision.push({id:uid(), text, img:dataUrl});
      finishVisionAdd();
    });
  } else {
    DATA.vision.push({id:uid(), text, img:imgUrl});
    finishVisionAdd();
  }
}
function finishVisionAdd(){
  document.getElementById('visionText').value='';
  document.getElementById('visionImg').value='';
  document.getElementById('visionFile').value='';
  persist(); renderVision();
  mascotReact('happy','Pinned.');
}
function resizeImageFile(file, maxDim, quality, cb){
  const reader = new FileReader();
  reader.onload = (e)=>{
    const img = new Image();
    img.onload = ()=>{
      let w = img.width, h = img.height;
      if(w>h && w>maxDim){ h = Math.round(h*maxDim/w); w = maxDim; }
      else if(h>maxDim){ w = Math.round(w*maxDim/h); h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function delVision(id){ DATA.vision = DATA.vision.filter(x=>x.id!==id); persist(); renderVision(); }
function renderVision(){
  const grid = document.getElementById('visionGrid');
  document.getElementById('visionEmpty').style.display = DATA.vision.length? 'none':'block';
  grid.innerHTML = DATA.vision.map((v,i)=>`
    <div class="vision-card" style="${v.img?'':'background:'+visionColors[i%visionColors.length]+';'}">
      ${v.img? `<img src="${v.img}" onerror="this.style.display='none'">` : ''}
      ${v.text? `<div class="vc-text">${escapeHtml(v.text)}</div>` : ''}
      <div class="vc-del"><span onclick="delVision(${v.id})">remove</span></div>
    </div>`).join('');

  const banner = document.getElementById('visionBanner');
  const withImages = DATA.vision.filter(v=>v.img);
  if(withImages.length){
    banner.style.display = 'block';
    const dur = withImages.length*4;
    banner.innerHTML = withImages.map((v,i)=>
      `<img src="${v.img}" style="animation-duration:${dur}s; animation-delay:${i*4}s;" onerror="this.style.display='none'">`
    ).join('');
  } else {
    banner.style.display = 'none';
    banner.innerHTML = '';
  }

  const withImagesForCollage = DATA.vision.filter(v=>v.img);
  const collage = document.getElementById('photoCollage');
  document.getElementById('photoCollageEmpty').style.display = withImagesForCollage.length? 'none':'block';
  if(collage){
    collage.innerHTML = withImagesForCollage.map(v=>{
      const safeImg = v.img.replace(/'/g,'&#39;');
      const safeText = (v.text||'').replace(/'/g,'&#39;');
      return `<div class="collage-tile" onclick='openLightbox(${JSON.stringify(safeImg)}, ${JSON.stringify(safeText)})'>
        <img src="${v.img}" onerror="this.parentElement.style.display='none'">
      </div>`;
    }).join('');
  }
}
function openLightbox(img, text){
  document.getElementById('lightboxImg').src = img;
  document.getElementById('lightboxText').textContent = text || '';
  document.getElementById('lightbox').classList.add('show');
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('show');
}

// ---------- FLASHCARDS ----------
let fcOrder = [], fcIndex = 0, fcFlippedState = false;
function addFlashcard(){
  const q = document.getElementById('fcQ').value.trim();
  const a = document.getElementById('fcA').value.trim();
  if(!q || !a) return;
  DATA.flashcards.push({id:uid(), q, a});
  document.getElementById('fcQ').value=''; document.getElementById('fcA').value='';
  persist(); renderFlashcards(true);
}
function fcShuffle(){
  fcOrder = DATA.flashcards.map(c=>c.id);
  for(let i=fcOrder.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [fcOrder[i],fcOrder[j]]=[fcOrder[j],fcOrder[i]]; }
  fcIndex = 0; fcFlippedState = false; renderFcStage();
}
function fcNext(){ fcIndex = (fcIndex+1) % fcOrder.length; fcFlippedState = false; renderFcStage(); }
function fcFlip(){ fcFlippedState = !fcFlippedState; renderFcStage(); }
function renderFcStage(){
  const stage = document.getElementById('fcStage');
  const controls = document.getElementById('fcControls');
  if(!DATA.flashcards.length){
    stage.innerHTML = '<div class="empty" id="fcEmptyMsg">Add a few cards above to start quizzing yourself.</div>';
    controls.style.display = 'none'; return;
  }
  controls.style.display = 'flex';
  const card = DATA.flashcards.find(c=>c.id===fcOrder[fcIndex]) || DATA.flashcards[0];
  stage.innerHTML = `
    <div class="fc-card ${fcFlippedState?'flipped':''}" onclick="fcFlip()">${escapeHtml(fcFlippedState? card.a : card.q)}</div>
    <div class="fc-progress">card ${fcIndex+1} of ${fcOrder.length} — tap to flip</div>`;
}
function renderFlashcards(newlyAdded){
  if(!fcOrder.length || newlyAdded){ fcShuffle(); } else { renderFcStage(); }
}

// ---------- MEMORY GAME ----------
const memoryThemes = {
  "Space":     ['🚀','🪐','⭐','🌙','🔭','🛰️','☄️','🌌'],
  "Garage":    ['🔧','⚡','🚗','🔋','🛠️','⚙️','🧲','📐'],
  "Nature":    ['🌲','🌊','🌻','🍃','🌵','🌈','🍄','🌸'],
  "Animals":   ['🐱','🐶','🦊','🐼','🐸','🐧','🦁','🐢'],
  "Food":      ['🍕','🍩','🍎','🍜','🍇','🍰','🍓','☕'],
  "Weather":   ['☀️','🌧️','⛈️','❄️','🌪️','🌤️','🌫️','🌊'],
  "Music":     ['🎵','🎸','🥁','🎹','🎤','🎧','🎷','🎻'],
  "Travel":    ['✈️','🗺️','🧳','🚆','🏔️','🏖️','🚌','🗽'],
  "Sports":    ['⚽','🏀','🏏','🎾','🏓','🏸','🥊','🏆'],
  "Office":    ['📎','📌','🖊️','📊','📁','💻','📅','🗂️']
};
let memState = { tiles:[], flipped:[], matched:[], busy:false };
let lastMemTheme = null;
function startMemoryGame(themeName){
  const names = Object.keys(memoryThemes);
  if(!themeName || themeName==='surprise'){
    const pool = names.filter(n=>n!==lastMemTheme);
    themeName = pool[Math.floor(Math.random()*pool.length)];
  }
  lastMemTheme = themeName;
  const sel = document.getElementById('memThemeSelect');
  if(sel) sel.value = themeName;
  const chosen = memoryThemes[themeName];
  const pairs = [...chosen, ...chosen];
  for(let i=pairs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pairs[i],pairs[j]]=[pairs[j],pairs[i]]; }
  memState = { tiles:pairs, flipped:[], matched:[], busy:false };
  document.getElementById('memoryStatus').textContent = `Match the pairs — ${themeName} set.`;
  renderMemory();
}
function renderMemory(){
  const grid = document.getElementById('memoryGrid');
  grid.innerHTML = memState.tiles.map((emoji,i)=>{
    const shown = memState.flipped.includes(i) || memState.matched.includes(i);
    const cls = memState.matched.includes(i) ? 'matched' : (memState.flipped.includes(i) ? 'flipped' : '');
    return `<div class="mem-tile ${cls}" onclick="memFlip(${i})">${shown? emoji : ''}</div>`;
  }).join('');
}
function memFlip(i){
  if(memState.busy || memState.flipped.includes(i) || memState.matched.includes(i)) return;
  memState.flipped.push(i);
  renderMemory();
  if(memState.flipped.length===2){
    memState.busy = true;
    const [a,b] = memState.flipped;
    if(memState.tiles[a]===memState.tiles[b]){
      memState.matched.push(a,b);
      memState.flipped = [];
      memState.busy = false;
      renderMemory();
      if(memState.matched.length===memState.tiles.length){
        document.getElementById('memoryStatus').textContent = 'Cleared it 🎉 — new game to go again.';
        mascotReact('cheer', 'You cleared it!', 2600); confettiBurst();
      } else {
        mascotReact('happy', 'Match!', 1200);
      }
    } else {
      setTimeout(()=>{ memState.flipped = []; memState.busy = false; renderMemory(); }, 700);
    }
  }
}

// ---------- quick add (Snapshot shortcuts) ----------
function quickAddTask(){
  const inp = document.getElementById('quickTaskInput');
  if(!inp.value.trim()) return;
  DATA.tasks.push({id:uid(), text:inp.value.trim(), done:false, date:todayStr()});
  inp.value=''; persist(); renderAll();
  mascotReact('happy', 'Added to today.');
}
function quickAddSpend(){
  const inp = document.getElementById('quickSpendInput');
  const amt = parseFloat(inp.value);
  if(!amt) return;
  const d = todayStr();
  if(!DATA.logs[d]) DATA.logs[d] = {spend:0, save:0, mood:null, notes:''};
  DATA.logs[d].spend = (DATA.logs[d].spend||0) + amt;
  inp.value='';
  document.getElementById('quickSpendStatus').textContent = `Today's spend so far: ₹${DATA.logs[d].spend}`;
  persist(); renderAll();
  mascotReact('happy', 'Logged.');
}

// ---------- office task log ----------
function addOfficeTask(redoOf){
  const inp = document.getElementById('officeTaskInput');
  const text = inp.value.trim();
  if(!text) return;
  const d = todayStr();
  const dup = DATA.officeTasks.some(o=>o.date===d && o.text.toLowerCase()===text.toLowerCase());
  if(dup){ toast('Already logged today'); return; }
  const dueInput = document.getElementById('officeDueDate').value;
  const kind = document.getElementById('officeKind').value;
  const domain = document.getElementById('officeDomain').value;
  const newId = uid();
  DATA.officeTasks.push({
    id:newId, text,
    domain, kind,
    date:d, dueDate: dueInput || d,
    done:false, note:'', completedDate:null,
    redoOf: redoOf || null
  });
  DATA.allTasks.push({
    id:'o'+newId, title:text, category: kind==='learning' ? 'Learning' : 'Office',
    status:'open', dueDate: dueInput || d, createdDate:d, completedDate:null,
    note:'', redoOf: redoOf ? ('o'+redoOf) : null, domain
  });
  inp.value=''; document.getElementById('officeDueDate').value='';
  persist(); renderOffice(); renderTasksView(); renderSnapshot();
  mascotReact('happy', 'Logged in Office.');
}
function syncTaskFromOffice(o){
  const t = DATA.allTasks.find(x=>x.id==='o'+o.id);
  if(t){
    t.status = o.done ? 'closed' : (t.status==='in-progress' ? 'in-progress':'open');
    t.completedDate = o.completedDate;
    t.dueDate = o.dueDate;
    t.note = o.note;
  }
}
function toggleOffice(id){
  const o = DATA.officeTasks.find(x=>x.id===id);
  if(o){
    o.done = !o.done;
    o.completedDate = o.done ? todayStr() : null;
    syncTaskFromOffice(o);
    persist(); renderOffice(); renderTasksView(); renderSnapshot();
    if(o.done){ mascotReact('cheer','Done.'); confettiBurst(); }
  }
}
function addOfficeNote(id){
  const o = DATA.officeTasks.find(x=>x.id===id);
  if(!o) return;
  const note = prompt('Why is this still open? (e.g. blocked, redoing tomorrow)', o.note||'');
  if(note!==null){ o.note = note.trim(); syncTaskFromOffice(o); persist(); renderOffice(); renderTasksView(); }
}
function extendOfficeDue(id){
  const o = DATA.officeTasks.find(x=>x.id===id);
  if(!o) return;
  const newDate = prompt('New due date (YYYY-MM-DD)', o.dueDate || o.date);
  if(newDate){ o.dueDate = newDate.trim(); syncTaskFromOffice(o); persist(); renderOffice(); renderTasksView(); }
}
function redoOfficeTask(id){
  const o = DATA.officeTasks.find(x=>x.id===id);
  if(!o) return;
  document.getElementById('officeTaskInput').value = o.text;
  document.getElementById('officeDomain').value = o.domain;
  document.getElementById('officeKind').value = o.kind;
  document.getElementById('officeDueDate').value = todayStr();
  addOfficeTask(o.id);
}
function delOffice(id){
  DATA.officeTasks = DATA.officeTasks.filter(x=>x.id!==id);
  DATA.allTasks = DATA.allTasks.filter(x=>x.id!==('o'+id));
  persist(); renderOffice(); renderTasksView(); renderSnapshot();
}
function officeStatusLabel(o){
  if(o.done) return 'Done';
  const today = todayStr();
  if(o.dueDate && o.dueDate < today) return 'Overdue';
  return 'Open';
}
function renderOffice(){
  const d = todayStr();
  const todays = DATA.officeTasks.filter(o=>o.date===d);
  const list = document.getElementById('officeList');
  document.getElementById('officeEmpty').style.display = todays.length? 'none':'block';
  list.innerHTML = todays.map(o=>`
    <li class="${o.done?'done':''}">
      <input type="checkbox" ${o.done?'checked':''} onchange="toggleOffice(${o.id})">
      <span class="txt">${escapeHtml(o.text)}
        ${o.redoOf ? `<div style="font-size:10.5px;color:var(--teal);">redo of an earlier incomplete task</div>` : ''}
        ${o.note ? `<div style="font-size:11px;color:var(--amber); margin-top:2px;">↳ ${escapeHtml(o.note)}</div>` : ''}
      </span>
      <span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${o.domain}${o.kind==='learning'?' · learning':''} · due ${o.dueDate||o.date}</span>
      ${!o.done ? `<span class="del" onclick="addOfficeNote(${o.id})" title="add reason" style="color:var(--muted);">✎</span>` : ''}
      ${!o.done ? `<span class="del" onclick="extendOfficeDue(${o.id})" title="extend due date" style="color:var(--muted);">📅</span>` : ''}
      <span class="del" onclick="delOffice(${o.id})">✕</span>
    </li>`).join('');

  const olderOpen = DATA.officeTasks.filter(o=>!o.done && o.date!==d);
  const olderList = document.getElementById('officeOpenOlder');
  document.getElementById('officeOpenOlderEmpty').style.display = olderOpen.length? 'none':'block';
  if(olderList){
    olderList.innerHTML = olderOpen.map(o=>`
      <li>
        <span class="txt">${escapeHtml(o.text)}
          <div style="font-size:10.5px;color:var(--muted);">logged ${o.date} · due ${o.dueDate||o.date} · ${officeStatusLabel(o)}</div>
          ${o.note ? `<div style="font-size:11px;color:var(--amber); margin-top:2px;">↳ ${escapeHtml(o.note)}</div>` : ''}
        </span>
        <button class="ghost" style="flex:0 0 auto; font-size:11px; padding:5px 10px;" onclick="redoOfficeTask(${o.id})">Log again today</button>
      </li>`).join('');
  }

  const domains = ['ADAS','BCM','HVAC','TPMS','Other'];
  const byDom = document.getElementById('officeByDomain');
  byDom.innerHTML = domains.map(dm=>{
    const count = todays.filter(o=>o.domain===dm).length;
    if(!count) return '';
    return `<div class="bar-row"><div class="bar-label">${dm}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(count*20,100)}%;"></div></div><div style="font-family:var(--mono); font-size:11px; width:20px;">${count}</div></div>`;
  }).join('') || '<div class="empty">Nothing logged yet.</div>';
}

// ---------- office CSV export ----------
function csvEscape(v){
  const s = String(v==null ? '' : v);
  return '"' + s.replace(/"/g,'""') + '"';
}
function exportOfficeCsv(){
  const from = document.getElementById('exportFrom').value;
  const to = document.getElementById('exportTo').value;
  let rows = DATA.officeTasks.slice();
  if(from) rows = rows.filter(o=>o.date >= from);
  if(to) rows = rows.filter(o=>o.date <= to);
  rows.sort((a,b)=> a.date.localeCompare(b.date));
  if(!rows.length){ toast('Nothing in that date range'); return; }
  const header = ['Date Registered','Category','Type','Task','Comment','Due Date','Completion Date','Status','Redo Of Earlier Task'];
  const lines = [header.map(csvEscape).join(',')];
  rows.forEach(o=>{
    lines.push([
      o.date, o.domain, o.kind==='learning'?'Learning':'Task', o.text, o.note||'',
      o.dueDate||o.date, o.completedDate||'', officeStatusLabel(o),
      o.redoOf ? 'Yes' : ''
    ].map(csvEscape).join(','));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `office-log_${from||'all'}_to_${to||'all'}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  mascotReact('happy','Downloaded.');
}

// ---------- office report — readable, printable, PDF-able ----------
function showOfficeReport(){
  const from = document.getElementById('exportFrom').value;
  const to = document.getElementById('exportTo').value;
  let rows = DATA.officeTasks.slice();
  if(from) rows = rows.filter(o=>o.date >= from);
  if(to) rows = rows.filter(o=>o.date <= to);
  if(!rows.length){ toast('Nothing in that date range'); return; }
  rows.sort((a,b)=> a.date.localeCompare(b.date));

  const byDate = {};
  rows.forEach(o=>{ (byDate[o.date] = byDate[o.date]||[]).push(o); });

  const findOriginal = (id)=> DATA.officeTasks.find(x=>x.id===id);
  const statusClass = (o)=> o.done ? 'rep-status-done' : (officeStatusLabel(o)==='Overdue' ? 'rep-status-overdue' : 'rep-status-open');

  let html = `<h1>Office Task Report</h1>
    <div class="rep-sub">${from||'earliest'} to ${to||'latest'} · generated ${new Date().toLocaleDateString()}</div>`;

  Object.keys(byDate).sort().forEach(date=>{
    html += `<div class="rep-day"><h2>${date}</h2>
      <table><thead><tr><th>Category</th><th>Type</th><th>Task</th><th>Status</th><th>Due</th><th>Completed</th><th>Comment</th></tr></thead><tbody>`;
    byDate[date].forEach(o=>{
      const orig = o.redoOf ? findOriginal(o.redoOf) : null;
      html += `<tr>
        <td>${escapeHtml(o.domain)}</td>
        <td>${o.kind==='learning'?'Learning':'Task'}</td>
        <td>${escapeHtml(o.text)}${orig? `<div style="font-size:10.5px;color:#888;">redo of task logged ${orig.date}</div>` : ''}</td>
        <td class="${statusClass(o)}">${officeStatusLabel(o)}</td>
        <td>${o.dueDate||o.date}</td>
        <td>${o.completedDate||'—'}</td>
        <td>${escapeHtml(o.note||'')}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });

  document.getElementById('printReportInner').innerHTML = html;
  document.getElementById('printReport').classList.add('show');
}
function closeOfficeReport(){
  document.getElementById('printReport').classList.remove('show');
}

// ---------- daily routine — ephemeral, in-memory only, resets on reload ----------
let routineItems = ["Check calendar for today","Skincare routine","Stretch / short walk"];
let routineChecked = new Set();
function addRoutineItem(){
  const inp = document.getElementById('routineInput');
  if(!inp.value.trim()) return;
  routineItems.push(inp.value.trim());
  inp.value=''; renderRoutine();
}
function toggleRoutine(i){
  if(routineChecked.has(i)) routineChecked.delete(i); else routineChecked.add(i);
  renderRoutine();
}
function renderRoutine(){
  const list = document.getElementById('routineList');
  if(!list) return;
  list.innerHTML = routineItems.map((r,i)=>`
    <li class="${routineChecked.has(i)?'done':''}">
      <input type="checkbox" ${routineChecked.has(i)?'checked':''} onchange="toggleRoutine(${i})">
      <span class="txt">${escapeHtml(r)}</span>
    </li>`).join('');
}

// ---------- study sessions ----------
function addStudySession(){
  const topic = document.getElementById('studyTopic').value.trim();
  const mins = parseInt(document.getElementById('studyMinutes').value);
  if(!topic || !mins) return;
  DATA.studySessions.push({id:uid(), topic, minutes:mins, date:todayStr()});
  document.getElementById('studyTopic').value=''; document.getElementById('studyMinutes').value='';
  persist(); renderStudy();
  mascotReact('happy', 'Nice, logged that study time.');
}
function delStudy(id){ DATA.studySessions = DATA.studySessions.filter(x=>x.id!==id); persist(); renderStudy(); }
function renderStudy(){
  const d = todayStr();
  const todays = DATA.studySessions.filter(s=>s.date===d);
  const list = document.getElementById('studyList');
  if(list) list.innerHTML = todays.map(s=>`
    <li><span class="txt">${escapeHtml(s.topic)}</span>
    <span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${s.minutes}m</span>
    <span class="del" onclick="delStudy(${s.id})">✕</span></li>`).join('');
  const total = todays.reduce((sum,s)=>sum+s.minutes,0);
  const totalEl = document.getElementById('studyTotal');
  if(totalEl) totalEl.textContent = total>0 ? `Total today: ${total} minutes` : '';
}

// ---------- notes reading view (pulls project notes) ----------
function renderNotes(){
  const withNotes = DATA.projects.filter(p=>p.notes && p.notes.trim());
  const el = document.getElementById('notesList');
  document.getElementById('notesEmpty').style.display = withNotes.length? 'none':'block';
  el.innerHTML = withNotes.map(p=>`
    <div class="note-card"><h4>${escapeHtml(p.name)}</h4><p>${escapeHtml(p.notes)}</p></div>`).join('');
}

// ---------- GK quiz ----------
const quizBank = [
  {q:"What is the capital of Australia?", opts:["Sydney","Canberra","Melbourne","Perth"], a:1},
  {q:"Who wrote the Indian national anthem?", opts:["Bankim Chandra","Rabindranath Tagore","Sarojini Naidu","Iqbal"], a:1},
  {q:"Which planet is known as the Red Planet?", opts:["Venus","Jupiter","Mars","Saturn"], a:2},
  {q:"What does 'CAN' stand for in vehicle electronics?", opts:["Controller Area Network","Central Auto Node","Car Access Network","Circuit Analog Node"], a:0},
  {q:"Which is the longest river in the world?", opts:["Amazon","Nile","Yangtze","Ganges"], a:1},
  {q:"Who is credited with inventing the World Wide Web?", opts:["Steve Jobs","Alan Turing","Tim Berners-Lee","Bill Gates"], a:2},
  {q:"What is the currency of Japan?", opts:["Won","Yuan","Ringgit","Yen"], a:3},
  {q:"How many bones are in the adult human body?", opts:["206","187","220","195"], a:0},
  {q:"Which Indian state has the longest coastline?", opts:["Kerala","Tamil Nadu","Gujarat","Andhra Pradesh"], a:2},
  {q:"What does 'ADAS' stand for?", opts:["Advanced Driver Assistance Systems","Automated Diagnostic Analysis System","Adaptive Drive Auto Sensor","Auto Detection Alert System"], a:0},
  {q:"Which gas do plants absorb from the atmosphere?", opts:["Oxygen","Nitrogen","Carbon Dioxide","Hydrogen"], a:2},
  {q:"Who was the first Prime Minister of India?", opts:["Sardar Patel","Jawaharlal Nehru","Rajendra Prasad","Lal Bahadur Shastri"], a:1},
  {q:"What is the largest organ in the human body?", opts:["Liver","Brain","Skin","Heart"], a:2},
  {q:"Which company originally developed the ARM processor architecture?", opts:["Intel","Acorn Computers","IBM","Texas Instruments"], a:1},
  {q:"What is the freezing point of water in Fahrenheit?", opts:["0°F","32°F","100°F","212°F"], a:1},
  {q:"Which Indian city is known as the 'Silicon Valley of India'?", opts:["Hyderabad","Pune","Bengaluru","Chennai"], a:2},
  {q:"What is the chemical symbol for gold?", opts:["Go","Gd","Au","Ag"], a:2},
  {q:"Who painted the Mona Lisa?", opts:["Michelangelo","Leonardo da Vinci","Raphael","Donatello"], a:1},
  {q:"Which is the smallest planet in our solar system?", opts:["Mars","Mercury","Venus","Pluto"], a:1},
  {q:"What does 'BCM' stand for in automotive electronics?", opts:["Body Control Module","Battery Charge Monitor","Brake Control Mechanism","Base Circuit Map"], a:0},
  {q:"Which country hosted the 2016 Summer Olympics?", opts:["China","UK","Brazil","Japan"], a:2},
  {q:"What is the tallest mountain in the world?", opts:["K2","Kangchenjunga","Mount Everest","Lhotse"], a:2},
  {q:"Who developed the theory of general relativity?", opts:["Isaac Newton","Albert Einstein","Niels Bohr","Galileo Galilei"], a:1},
  {q:"Which Indian festival is known as the 'festival of lights'?", opts:["Holi","Navratri","Diwali","Eid"], a:2},
  {q:"What is the national animal of India?", opts:["Lion","Tiger","Elephant","Leopard"], a:1},
  {q:"Which programming language is primarily used for iOS app development?", opts:["Java","Swift","Kotlin","C#"], a:1},
  {q:"What does 'TPMS' stand for in vehicles?", opts:["Tire Pressure Monitoring System","Torque Power Management Sensor","Transmission Position Monitor Setting","Total Performance Metrics System"], a:0},
  {q:"Which is the largest desert in the world?", opts:["Sahara","Gobi","Antarctic","Arabian"], a:2},
  {q:"Who is known as the 'Father of the Indian Constitution'?", opts:["Mahatma Gandhi","Jawaharlal Nehru","B.R. Ambedkar","Sardar Patel"], a:2},
  {q:"What is the speed of light approximately?", opts:["3,00,000 km/s","1,50,000 km/s","5,00,000 km/s","1,00,000 km/s"], a:0},
  {q:"Which ocean is the largest?", opts:["Atlantic","Indian","Arctic","Pacific"], a:3},
  {q:"What is the powerhouse of the cell called?", opts:["Nucleus","Ribosome","Mitochondria","Golgi body"], a:2},
  {q:"Which Indian state is the largest producer of tea?", opts:["Kerala","Assam","Tamil Nadu","West Bengal"], a:1},
  {q:"Who wrote 'Romeo and Juliet'?", opts:["Charles Dickens","William Shakespeare","Jane Austen","Mark Twain"], a:1},
  {q:"What is the hardest natural substance on Earth?", opts:["Gold","Iron","Diamond","Quartz"], a:2},
  {q:"Which gas makes up most of Earth's atmosphere?", opts:["Oxygen","Carbon Dioxide","Nitrogen","Hydrogen"], a:2},
  {q:"What does 'LDWS' stand for in ADAS?", opts:["Lane Departure Warning System","Long Distance Wireless Sensor","Load Detection Warning Signal","Lateral Drive Weight Sensor"], a:0},
  {q:"Which Indian river is considered the holiest?", opts:["Yamuna","Ganga","Godavari","Narmada"], a:1},
  {q:"What is the capital of Canada?", opts:["Toronto","Vancouver","Ottawa","Montreal"], a:2},
  {q:"Which planet has the most moons?", opts:["Jupiter","Saturn","Uranus","Neptune"], a:1},
  {q:"What does 'MOIS' stand for in ADAS?", opts:["Moving Object Indication System","Manual Override Input Sensor","Motion Output Indicator Switch","Mobile Object Identification Sensor"], a:0},
  {q:"Who is the author of the Harry Potter series?", opts:["J.R.R. Tolkien","J.K. Rowling","C.S. Lewis","Roald Dahl"], a:1},
  {q:"Which is the smallest country in the world?", opts:["Monaco","San Marino","Vatican City","Liechtenstein"], a:2},
  {q:"What is the boiling point of water at sea level (Celsius)?", opts:["90°C","100°C","110°C","120°C"], a:1},
  {q:"Which Indian city is known as the 'Pink City'?", opts:["Udaipur","Jodhpur","Jaipur","Bikaner"], a:2},
  {q:"What does 'DDAW' stand for in ADAS?", opts:["Driver Drowsiness and Attention Warning","Dual Direction Alert Warning","Digital Dash Alert Wiring","Driver Data Access Warning"], a:0},
  {q:"Who discovered gravity?", opts:["Albert Einstein","Isaac Newton","Galileo Galilei","Nikola Tesla"], a:1},
  {q:"Which is the longest wall in the world?", opts:["Great Wall of China","Berlin Wall","Wall of Jericho","Hadrian's Wall"], a:0},
  {q:"What is the currency of the United Kingdom?", opts:["Euro","Pound Sterling","Dollar","Franc"], a:1},
  {q:"Which Indian scientist is known for the 'Missile Man of India' title?", opts:["C.V. Raman","Homi Bhabha","A.P.J. Abdul Kalam","Vikram Sarabhai"], a:2},
  {q:"What is the chemical symbol for sodium?", opts:["So","Sd","Na","Sn"], a:2},
  {q:"Which continent is the Sahara Desert located in?", opts:["Asia","Africa","Australia","South America"], a:1},
  {q:"What does 'MOSFET' stand for?", opts:["Metal-Oxide-Semiconductor Field-Effect Transistor","Multi-Output Semiconductor Field Energy Transistor","Metal Optical Sensor Field Effect Tool","Modular Semiconductor Feedback Transistor"], a:0},
  {q:"Who was the first man to walk on the moon?", opts:["Buzz Aldrin","Yuri Gagarin","Neil Armstrong","John Glenn"], a:2},
  {q:"Which Indian state is home to the Sun Temple at Konark?", opts:["West Bengal","Odisha","Bihar","Jharkhand"], a:1},
  {q:"What is the largest mammal in the world?", opts:["African Elephant","Blue Whale","Giraffe","Sperm Whale"], a:1},
  {q:"Which language has the most native speakers worldwide?", opts:["English","Hindi","Mandarin Chinese","Spanish"], a:2},
  {q:"What does 'BSIS' stand for in ADAS?", opts:["Blind Spot Information System","Basic Sensor Input System","Brake Signal Indication System","Body Sensor Interface System"], a:0},
  {q:"Who composed India's national song 'Vande Mataram'?", opts:["Rabindranath Tagore","Bankim Chandra Chattopadhyay","Sarojini Naidu","Muhammad Iqbal"], a:1},
  {q:"Which planet takes the longest to orbit the Sun?", opts:["Saturn","Uranus","Neptune","Jupiter"], a:2},
  {q:"What is the study of earthquakes called?", opts:["Seismology","Geology","Meteorology","Volcanology"], a:0},
  {q:"Which Indian city hosts the annual Kumbh Mela most famously?", opts:["Varanasi","Prayagraj","Haridwar","Nashik"], a:1},
  {q:"What does 'ECU' stand for in a vehicle?", opts:["Electronic Control Unit","Engine Charging Unit","External Circuit Unit","Electric Current Utility"], a:0},
  {q:"Who wrote the play 'Hamlet'?", opts:["Christopher Marlowe","William Shakespeare","Ben Jonson","John Milton"], a:1},
  {q:"Which is the deepest point in the world's oceans?", opts:["Puerto Rico Trench","Mariana Trench","Java Trench","Tonga Trench"], a:1},
  {q:"What is the national bird of India?", opts:["Peacock","Parrot","Crane","Sparrow"], a:0},
  {q:"Which company developed the Android operating system?", opts:["Apple","Microsoft","Google","Samsung"], a:2},
  {q:"What is the value of Pi rounded to two decimal places?", opts:["3.12","3.14","3.16","3.18"], a:1},
  {q:"Which Indian freedom fighter is known as 'Netaji'?", opts:["Bhagat Singh","Subhas Chandra Bose","Chandrashekhar Azad","Lala Lajpat Rai"], a:1},
  {q:"What does 'GPS' stand for?", opts:["General Position System","Global Positioning System","Geo Pathway Sensor","Ground Positioning Signal"], a:1},
  {q:"Which is the fastest land animal?", opts:["Lion","Cheetah","Horse","Antelope"], a:1},
  {q:"What is the main gas used in refrigeration/AC cooling cycles?", opts:["Nitrogen","Refrigerant (R-134a or similar)","Oxygen","Helium"], a:1},
  {q:"Who invented the telephone?", opts:["Thomas Edison","Alexander Graham Bell","Nikola Tesla","Guglielmo Marconi"], a:1}
];
let quizOrder = [], quizIndex = 0, quizScore = 0, quizAnswered = false;
let quizUsed = new Set(DATA.gameProgress.quizUsed || []);
let quizMode = 'local', onlineQuizPool = [];
function decodeHtmlEntities(str){
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}
async function startQuiz(){
  const stage = document.getElementById('quizStage');
  const scoreEl = document.getElementById('quizScore');
  if(stage) stage.innerHTML = '<div class="empty">Fetching fresh questions…</div>';
  if(scoreEl) scoreEl.textContent = '';

  let gotOnline = false;
  const level = DATA.gameProgress.quizLevel || 1;
  const difficulty = level<=2 ? 'easy' : level<=4 ? 'medium' : 'hard';
  // real GK categories only — General Knowledge, Science, Geography, History, Politics, Vehicles — no Entertainment/Movies/Celebrities. Dropped a couple of very small categories that often don't have 8 questions available.
  const gkCategories = [9, 17, 18, 22, 23, 24, 28];
  async function tryFetchQuiz(cat){
    const controller = new AbortController();
    const timeoutId = setTimeout(()=>controller.abort(), 4000);
    const resp = await fetch(`https://opentdb.com/api.php?amount=8&type=multiple&category=${cat}&difficulty=${difficulty}`, {signal:controller.signal});
    clearTimeout(timeoutId);
    return resp.json();
  }
  try{
    const firstCat = gkCategories[Math.floor(Math.random()*gkCategories.length)];
    let data = await tryFetchQuiz(firstCat);
    if(!(data && data.response_code===0 && data.results && data.results.length===8)){
      const remaining = gkCategories.filter(c=>c!==firstCat);
      const secondCat = remaining[Math.floor(Math.random()*remaining.length)];
      data = await tryFetchQuiz(secondCat);
    }
    if(data && data.response_code===0 && data.results && data.results.length===8){
      onlineQuizPool = data.results.map(r=>{
        const correct = decodeHtmlEntities(r.correct_answer);
        const opts = [...r.incorrect_answers.map(decodeHtmlEntities), correct];
        for(let i=opts.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [opts[i],opts[j]]=[opts[j],opts[i]]; }
        return { q: decodeHtmlEntities(r.question), opts, a: opts.indexOf(correct) };
      });
      gotOnline = true;
    }
  }catch(e){ /* offline, blocked, or timed out — fall back below */ }

  if(gotOnline){
    quizMode = 'online';
    quizOrder = onlineQuizPool.map((_,i)=>i);
  } else {
    quizMode = 'local';
    let available = quizBank.map((_,i)=>i).filter(i=>!quizUsed.has(i));
    if(available.length < 8){ quizUsed = new Set(); available = quizBank.map((_,i)=>i); }
    for(let i=available.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [available[i],available[j]]=[available[j],available[i]]; }
    quizOrder = available.slice(0,8);
    quizOrder.forEach(i=>quizUsed.add(i));
    DATA.gameProgress.quizUsed = [...quizUsed];
    persist();
  }
  quizIndex = 0; quizScore = 0; quizAnswered = false;
  renderQuizStage();
}
function currentQuizItem(){
  return quizMode==='online' ? onlineQuizPool[quizOrder[quizIndex]] : quizBank[quizOrder[quizIndex]];
}
const levelNames = {1:'Basics',2:'Basics+',3:'Medium',4:'Medium+',5:'Advanced'};
function resetQuizLevel(){
  DATA.gameProgress.quizLevel = 1;
  persist();
  toast('Back to Basics');
  startQuiz();
}
function renderQuizStage(){
  const stage = document.getElementById('quizStage');
  const scoreEl = document.getElementById('quizScore');
  const level = DATA.gameProgress.quizLevel || 1;
  if(quizIndex >= quizOrder.length){
    let levelChangeMsg = '';
    if(quizMode==='online'){
      if(quizScore>=7 && level<5){
        DATA.gameProgress.quizLevel = level+1; persist();
        levelChangeMsg = `<div style="color:var(--teal); font-size:12.5px; margin-top:8px;">Leveled up → ${levelNames[level+1]}</div>`;
      } else if(quizScore<=2 && level>1){
        DATA.gameProgress.quizLevel = level-1; persist();
        levelChangeMsg = `<div style="color:var(--amber); font-size:12.5px; margin-top:8px;">Dropped back → ${levelNames[level-1]}, to rebuild the basics</div>`;
      }
    }
    stage.innerHTML = `<div style="font-size:16px;font-weight:700;">Round done — ${quizScore}/${quizOrder.length} correct</div>${levelChangeMsg}`;
    scoreEl.textContent = '';
    if(quizScore===quizOrder.length) { mascotReact('cheer','Perfect round!'); confettiBurst(); }
    return;
  }
  const item = currentQuizItem();
  quizAnswered = false;
  stage.innerHTML = `
    <div style="font-size:10.5px; color:var(--muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:.5px;">Level ${level} — ${levelNames[level]} · ${quizMode==='online'?'● live':'○ offline bank'}</div>
    <div style="font-size:14.5px; font-weight:600; margin-bottom:12px;">${escapeHtml(item.q)}</div>
    ${item.opts.map((o,i)=>`<div class="quiz-opt" onclick="quizAnswer(${i})">${escapeHtml(o)}</div>`).join('')}
  `;
  scoreEl.textContent = `Question ${quizIndex+1} of ${quizOrder.length} · score ${quizScore}`;
}
function quizAnswer(i){
  if(quizAnswered) return;
  quizAnswered = true;
  const item = currentQuizItem();
  const opts = document.querySelectorAll('.quiz-opt');
  opts.forEach((el,idx)=>{
    if(idx===item.a) el.classList.add('correct');
    else if(idx===i) el.classList.add('wrong');
  });
  if(i===item.a){ quizScore++; mascotReact('happy','Correct!'); }
  else mascotReact('worried','Not quite.');
  setTimeout(()=>{ quizIndex++; renderQuizStage(); }, 900);
}

// ---------- flow: vision -> snapshot -> today -> office ----------
const flowOrder = {
  snapshot:'habits', habits:'tasks', tasks:'goals', goals:'office', office:'shopping',
  shopping:'projects', projects:'notes', notes:'finance', finance:'play',
  play:'ideas', ideas:'history', history:'snapshot'
};

// ---------- word scramble ----------
const wordBank = ["SENSOR","BRAKE","CIRCUIT","VOLTAGE","MODULE","MIRROR","BATTERY","STEERING","BUMPER","THROTTLE",
  "GARDEN","SUNSET","PENCIL","OCEAN","MARKET","JOURNEY","PLANET","WINDOW","BRIDGE","HARVEST",
  "COMPASS","LANTERN","MEADOW","GRANITE","VELVET","ORCHID","CANYON","GLACIER","FALCON","EMBER",
  "TURBINE","RESISTOR","CAPACITOR","CONNECTOR","HARNESS","GASKET","PISTON","RADIATOR","ALTERNATOR","CLUTCH",
  "WHISTLE","BLANKET","UMBRELLA","FOUNTAIN","STAIRCASE","BALCONY","CHIMNEY","ORCHARD","VINEYARD","PLATEAU",
  "VOLCANO","TSUNAMI","AVALANCHE","HORIZON","TWILIGHT","MIDNIGHT","THUNDER","BLIZZARD","MONSOON","CRYSTAL"];
let scrambleUsed = new Set(DATA.gameProgress.scrambleUsed || []), scrambleWord = '', scrambleAnswer = '';
function scrambleLetters(word){
  const arr = word.split('');
  let s;
  do{
    for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    s = arr.join('');
  } while(s===word && word.length>1);
  return s;
}
function startScramble(){
  let available = wordBank.map((_,i)=>i).filter(i=>!scrambleUsed.has(i));
  if(!available.length){ scrambleUsed = new Set(); available = wordBank.map((_,i)=>i); }
  const idx = available[Math.floor(Math.random()*available.length)];
  scrambleUsed.add(idx);
  DATA.gameProgress.scrambleUsed = [...scrambleUsed];
  persist();
  scrambleAnswer = wordBank[idx];
  scrambleWord = scrambleLetters(scrambleAnswer);
  const stage = document.getElementById('scrambleStage');
  stage.innerHTML = `
    <div style="font-size:26px; font-weight:700; letter-spacing:4px; font-family:var(--mono); margin-bottom:14px;">${scrambleWord}</div>
    <input type="text" id="scrambleInput" placeholder="Type your answer" style="max-width:220px; margin:0 auto; display:block; text-align:center;" onkeydown="if(event.key==='Enter') checkScramble()">
    <div id="scrambleFeedback" style="margin-top:8px; font-size:12.5px; min-height:18px;"></div>
    <div style="margin-top:10px;"><button class="ghost" onclick="checkScramble()">Check</button></div>
  `;
  document.getElementById('scrambleInput').focus();
}
function checkScramble(){
  const inp = document.getElementById('scrambleInput');
  const fb = document.getElementById('scrambleFeedback');
  if(inp.value.trim().toUpperCase()===scrambleAnswer){
    fb.textContent = 'Correct! ' + scrambleAnswer;
    fb.style.color = 'var(--teal)';
    mascotReact('cheer', 'Nice!'); confettiBurst();
    setTimeout(startScramble, 1100);
  } else {
    fb.textContent = 'Not quite — try again';
    fb.style.color = 'var(--red)';
    mascotReact('worried', 'Close, try again.');
  }
}

// ---------- quick math ----------
let mathScore = 0, mathRound = 0, mathAnswer = 0;
function startQuickMath(){ mathScore = 0; mathRound = 0; nextMathQuestion(); }
function nextMathQuestion(){
  if(mathRound >= 8){
    document.getElementById('mathStage').innerHTML = `<div style="font-size:16px;font-weight:700;">Round done — ${mathScore}/8 correct</div>`;
    if(mathScore===8){ mascotReact('cheer','Perfect round!'); confettiBurst(); }
    return;
  }
  mathRound++;
  const a = Math.floor(Math.random()*40)+1, b = Math.floor(Math.random()*40)+1;
  const ops = ['+','-','×'];
  const op = ops[Math.floor(Math.random()*ops.length)];
  mathAnswer = op==='+' ? a+b : op==='-' ? a-b : a*(Math.floor(Math.random()*10)+1);
  const displayB = op==='×' ? (mathAnswer/a) : b;
  const stage = document.getElementById('mathStage');
  stage.innerHTML = `
    <div style="font-size:22px; font-weight:700; margin-bottom:14px;">${a} ${op} ${displayB} = ?</div>
    <input type="number" id="mathInput" placeholder="Answer" style="max-width:160px; margin:0 auto; display:block; text-align:center;" onkeydown="if(event.key==='Enter') checkMath()">
    <div id="mathFeedback" style="margin-top:8px; font-size:12.5px; min-height:18px;"></div>
    <div style="margin-top:10px;"><button class="ghost" onclick="checkMath()">Check</button></div>
    <div class="fc-progress">question ${mathRound} of 8 · score ${mathScore}</div>
  `;
  document.getElementById('mathInput').focus();
}
function checkMath(){
  const inp = document.getElementById('mathInput');
  const fb = document.getElementById('mathFeedback');
  if(parseInt(inp.value,10)===mathAnswer){
    fb.textContent = 'Correct!'; fb.style.color='var(--teal)'; mathScore++;
    mascotReact('happy','Correct!');
  } else {
    fb.textContent = `Answer was ${mathAnswer}`; fb.style.color='var(--red)';
    mascotReact('worried','Not quite.');
  }
  setTimeout(nextMathQuestion, 800);
}

// ---------- game picker ----------
const gamePanels = ['flashcards','memory','quiz','scramble','math'];
function pickGame(name){
  gamePanels.forEach(g=>{
    const panel = document.getElementById('panel-'+g);
    if(panel) panel.style.display = (g===name) ? 'block' : 'none';
  });
  document.querySelectorAll('.game-pick-btn').forEach(b=>b.classList.toggle('active', b.dataset.game===name));
  document.getElementById('gamePickerRow').style.display = 'none';
  document.getElementById('gameBackRow').style.display = 'flex';
  if(name==='scramble') startScramble();
  if(name==='math') startQuickMath();
  if(name==='memory') startMemoryGame(document.getElementById('memThemeSelect') ? document.getElementById('memThemeSelect').value : undefined);
  if(name==='quiz') startQuiz();
}
function backToGames(){
  gamePanels.forEach(g=>{ const p=document.getElementById('panel-'+g); if(p) p.style.display='none'; });
  document.getElementById('gamePickerRow').style.display = 'grid';
  document.getElementById('gameBackRow').style.display = 'none';
}

function flowAdvance(fromView){
  const next = flowOrder[fromView];
  if(!next) return;
  const nextTab = document.querySelector(`.tab[data-view="${next}"]`);
  if(nextTab) nextTab.click();
  window.scrollTo({top:0, behavior:'smooth'});
}
function initFlowNext(){
  document.querySelectorAll('.flow-next[data-flow]').forEach(el=>{
    const from = el.dataset.flow;
    const next = flowOrder[from];
    const nextTab = document.querySelector(`.tab[data-view="${next}"]`);
    if(nextTab){
      const label = nextTab.textContent.replace(/^\s*\d+\s*/,'').trim();
      const span = el.querySelector('span');
      if(span) span.textContent = label;
    }
  });
}
let flowScrollLock = false;
window.addEventListener('wheel', (e)=>{
  const activeView = document.querySelector('.view.active');
  if(!activeView || !flowOrder[activeView.id.replace('view-','')]) return;
  const nearBottom = (document.body.scrollHeight - window.scrollY - window.innerHeight) < 60;
  if(e.deltaY>60 && nearBottom && !flowScrollLock){
    flowScrollLock = true;
    flowAdvance(activeView.id.replace('view-',''));
    setTimeout(()=>{ flowScrollLock=false; }, 900);
  }
}, {passive:true});

function renderAll(){
  renderSnapshot(); renderHistory(); renderProjects(); renderFinance(); renderGoals(); renderHabits(); renderIdeas();
  renderShopping(); renderVision(); renderFlashcards(false);
  renderOffice(); renderNotes(); renderStudy(); renderRoutine(); renderTasksView();
}

// ---------- init ----------
loadTodayFields();
loadFinanceFields();
renderAll();
animateTitle(document.querySelector('.view.active .title'));
const savedClientId = localStorage.getItem('lifeos_gcid');
if(savedClientId) document.getElementById('gClientId').value = savedClientId;
if(savedClientId) attemptSilentConnect();
initFlowNext();
const _wrap = document.querySelector('.mascot-wrap');
if(_wrap) _wrap.style.right = '18px';
