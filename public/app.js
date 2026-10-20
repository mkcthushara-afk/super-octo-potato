const COLS = ['clients','projects','bills','payments'];
const S = {clients:[],projects:[],bills:[],payments:[],settings:{},loaded:false,mode:'pending'};
let view = {name:'home'}, draft = null, filter = 'Active';
const $app = document.getElementById('app');

const TYPES = {'Invoice':'INV','Running bill':'RB','Quotation':'QT'};
const CATS = ['Labour','Material','Equipment','Other'];
const UNITS = ['nos','days','bags','cube','sq.ft','ft','m','sq.m','kg','L','perch','lump sum'];
const METHODS = ['Cash','Bank transfer','Cheque','Online / card'];
const PRESETS = [
  {desc:'Mason (baas) wages',cat:'Labour',unit:'days'},
  {desc:'Helper / labourer wages',cat:'Labour',unit:'days'},
  {desc:'Carpenter wages',cat:'Labour',unit:'days'},
  {desc:'Bar bender wages',cat:'Labour',unit:'days'},
  {desc:'Plastering',cat:'Labour',unit:'sq.ft'},
  {desc:'Cement 50kg',cat:'Material',unit:'bags'},
  {desc:'Sand',cat:'Material',unit:'cube'},
  {desc:'Metal 3/4"',cat:'Material',unit:'cube'},
  {desc:'Bricks',cat:'Material',unit:'nos'},
  {desc:'Cement blocks 6"',cat:'Material',unit:'nos'},
  {desc:'Steel (tor) bars',cat:'Material',unit:'kg'},
  {desc:'Concrete mixer hire',cat:'Equipment',unit:'days'},
  {desc:'Transport',cat:'Other',unit:'lump sum'},
];

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const money = v => n(v).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const rs = v => 'Rs. ' + money(v);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const fdate = iso => { if(!iso) return ''; const d = new Date(iso+'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const byId = (col,id) => S[col].find(x => x.id === id);
const isEx = o => o && o.example ? '<span class="pill ex">Example</span>' : '';

const lineAmt = it => n(it.qty) * n(it.rate);
const billSub = b => (b.items||[]).reduce((a,it) => a + lineAmt(it), 0);
const billTotal = b => billSub(b) - n(b.discount);
const counts = b => b.type !== 'Quotation';
const sortKey = x => (x.date||'') + '|' + String(x.createdAt||0).padStart(15,'0');

function projectStats(pid){
  const bills = S.bills.filter(b => b.projectId === pid && counts(b));
  const pays = S.payments.filter(p => p.projectId === pid);
  const billed = bills.reduce((a,b) => a + billTotal(b), 0);
  const paid = pays.reduce((a,p) => a + n(p.amount), 0);
  return {billed, paid, balance: billed - paid, bills: bills.length};
}
function accountAt(b){
  const k = sortKey(b);
  const billed = S.bills.filter(x => x.projectId === b.projectId && counts(x) && sortKey(x) <= k).reduce((a,x) => a + billTotal(x), 0);
  const paid = S.payments.filter(p => p.projectId === b.projectId && (p.date||'') <= (b.date||'')).reduce((a,p) => a + n(p.amount), 0);
  return {previous: billed - billTotal(b), billed, paid, balance: billed - paid};
}
function nextNo(type){
  const pre = TYPES[type] || 'INV';
  let max = 0;
  S.bills.forEach(b => { const m = String(b.no||'').match(new RegExp('^'+pre+'-(\\d+)$')); if(m) max = Math.max(max, +m[1]); });
  return pre + '-' + String(max+1).padStart(4,'0');
}
function toast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2600); }

/* ---------- storage: this contractor's records on the server ---------- */
async function api(method, url, body){
  let r;
  try{ r = await fetch(url, {method, credentials:'same-origin', headers:{'Content-Type':'application/json','X-SBB':'1'}, body: body ? JSON.stringify(body) : undefined}); }
  catch(e){ toast('No connection. Check your internet and try again.'); throw e; }
  if(r.status === 401){ location.href = '/login'; throw new Error('logged out'); }
  const data = await r.json().catch(() => ({}));
  if(!r.ok){ toast(data.error || 'Could not save. Try again.'); throw new Error(data.error); }
  return data;
}
async function put(col, obj){
  const id = obj.id || newId();
  const body = {...obj}; delete body.id;
  body.createdAt = body.createdAt || Date.now(); body.updatedAt = Date.now();
  await api('PUT', `/api/records/${col}/${id}`, body);
  const i = S[col].findIndex(x => x.id === id); const rec = {...body, id};
  if(i >= 0) S[col][i] = rec; else S[col].push(rec);
  return id;
}
async function remove(col, id){
  await api('DELETE', `/api/records/${col}/${id}`);
  S[col] = S[col].filter(x => x.id !== id);
}
async function putSettings(o){ await api('PUT', '/api/settings', o); S.settings = o; }

async function init(){
  try{
    const [d, me] = await Promise.all([api('GET', '/api/data'), api('GET', '/api/me')]);
    COLS.forEach(c => S[c] = d[c] || []); S.settings = d.settings || {}; S.me = me;
    S.mode = 'server'; S.loaded = true; render();
  }catch(e){ $app.innerHTML = '<div class="empty" style="margin-top:24px"><p class="muted" style="margin:0">Could not load your bill book. Check your connection and reload the page.</p></div>'; }
}

/* ---------- navigation ---------- */
function go(name, params){ view = {name, ...(params||{})}; draft = null; render(); window.scrollTo(0,0); }

function render(){
  document.getElementById('brand').firstChild.textContent = S.settings.name || 'Site Bill Book';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === ({home:'home',project:'home',bill:'home',billEdit:'home',payEdit:'home',projectEdit:'home',clients:'clients',clientEdit:'clients',settings:'settings'})[view.name]));
  if(!S.loaded){ $app.innerHTML = '<p class="muted" style="padding-top:24px">Opening your bill book…</p>'; return; }
  const V = {home:vHome,project:vProject,bill:vBill,billEdit:vBillEdit,payEdit:vPayEdit,projectEdit:vProjectEdit,clients:vClients,clientEdit:vClientEdit,settings:vSettings}[view.name] || vHome;
  $app.innerHTML = '<div class="fade">' + V() + '</div>';
  if(view.name === 'billEdit') recalc();
}

/* ---------- views ---------- */
function vHome(){
  const month = today().slice(0,7);
  let due = 0; S.projects.forEach(p => { const b = projectStats(p.id).balance; if(b > 0) due += b; });
  const recv = S.payments.filter(p => (p.date||'').slice(0,7) === month).reduce((a,p) => a + n(p.amount), 0);
  const billed = S.bills.filter(b => counts(b) && (b.date||'').slice(0,7) === month).reduce((a,b) => a + billTotal(b), 0);
  const list = S.projects.filter(p => filter === 'All' || (p.status||'Active') === filter)
    .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  const setup = !S.settings.name ? `<div class="banner">Add your business name, phone and bank details in <button class="btn sm ghost" data-go="settings">My business</button> so they print on every bill.</div>` : '';
  return `${setup}
  <div class="tiles">
    <div class="tile due"><div class="eyebrow">Clients owe you</div><div class="v">${rs(due)}</div></div>
    <div class="tile"><div class="eyebrow">Billed this month</div><div class="v">${rs(billed)}</div></div>
    <div class="tile"><div class="eyebrow">Received this month</div><div class="v">${rs(recv)}</div></div>
  </div>
  <section>
    <div class="spread"><h2>Projects</h2>
      <div class="row">
        ${S.projects.length ? `<button class="btn" data-act="newBill">New bill</button><button class="btn" data-act="newPay">Record payment</button>` : ''}
        <button class="btn pri" data-go="projectEdit">+ New project</button>
      </div></div>
    ${S.projects.length ? `<div class="chips">${['Active','On hold','Completed','All'].map(f => `<button class="chip ${filter===f?'on':''}" data-filter="${f}">${f}</button>`).join('')}</div>` : ''}
    ${!S.projects.length ? `<div class="empty"><h3>No projects yet</h3><p class="muted" style="margin:0;max-width:42ch">Add a client's house job as a project. Then bill labour and materials against it and record each payment as it comes in.</p><button class="btn pri" data-go="projectEdit">Add your first project</button></div>`
     : !list.length ? `<div class="empty"><p class="muted" style="margin:0">No ${esc(filter.toLowerCase())} projects.</p></div>`
     : `<div class="list">${list.map(projRow).join('')}</div>`}
  </section>`;
}
function projRow(p){
  const c = byId('clients', p.clientId) || {};
  const st = projectStats(p.id);
  const pct = n(p.contractValue) > 0 ? Math.min(100, st.billed / n(p.contractValue) * 100) : 0;
  const tag = st.bills === 0 ? '<span class="pill">No bills</span>' : st.balance > 0.005 ? `<div class="num" style="color:var(--due);font-weight:500">${rs(st.balance)}</div><div class="s">due</div>` : st.balance < -0.005 ? `<span class="pill acc">Advance ${money(-st.balance)}</span>` : '<span class="pill ok">Settled</span>';
  return `<button class="item" data-go="project" data-id="${p.id}">
    <div class="main"><div class="t">${esc(p.name)}${isEx(p)}</div><div class="s">${esc(c.name||'No client')}${p.site ? ' · ' + esc(p.site) : ''}</div>
      ${n(p.contractValue) > 0 ? `<div class="bar" title="${pct.toFixed(0)}% of contract billed"><i style="width:${pct}%"></i></div>` : ''}</div>
    <div class="r">${tag}</div></button>`;
}

function vProject(){
  const p = byId('projects', view.id); if(!p) return notFound();
  const c = byId('clients', p.clientId) || {};
  const st = projectStats(p.id);
  const bills = S.bills.filter(b => b.projectId === p.id).sort((a,b) => sortKey(b).localeCompare(sortKey(a)));
  const rows = statement(p.id);
  return `<button class="back" data-go="home">← Projects</button>
  <div class="spread" style="margin-top:6px"><div style="min-width:0"><div class="eyebrow">${esc(p.status||'Active')} project</div><h1>${esc(p.name)}${isEx(p)}</h1>
    <div class="muted">${esc(c.name||'No client')}${c.phone ? ' · <span class="num">' + esc(c.phone) + '</span>' : ''}${p.site ? ' · ' + esc(p.site) : ''}</div></div>
    <button class="btn sm" data-go="projectEdit" data-id="${p.id}">Edit project</button></div>
  <div class="tiles">
    <div class="tile ${st.balance>0.005?'due':''}"><div class="eyebrow">Balance due</div><div class="v">${rs(st.balance)}</div></div>
    <div class="tile"><div class="eyebrow">Billed</div><div class="v">${rs(st.billed)}</div>${n(p.contractValue)>0?`<div class="hint">of ${rs(p.contractValue)} contract</div>`:''}</div>
    <div class="tile"><div class="eyebrow">Received</div><div class="v">${rs(st.paid)}</div></div>
  </div>
  <div class="row" style="margin-top:14px">
    <button class="btn pri" data-act="newBill" data-id="${p.id}">+ New bill</button>
    <button class="btn" data-act="newPay" data-id="${p.id}">Record payment</button>
    ${rows.length ? `<button class="btn" data-act="stmtPdf" data-id="${p.id}">Statement PDF</button>${canShareFiles() ? `<button class="btn" data-act="stmtShare" data-id="${p.id}">Share statement</button>` : ''}<button class="btn" data-act="stmtText" data-id="${p.id}">Copy statement</button>` : ''}
  </div>
  <section><h2>Bills & quotations</h2>
    ${bills.length ? `<div class="list">${bills.map(b => `<button class="item" data-go="bill" data-id="${b.id}">
      <div class="main"><div class="t">${esc(b.title || b.type)}${isEx(b)}</div><div class="s"><span class="num">${esc(b.no)}</span> · ${fdate(b.date)}</div></div>
      <div class="r"><div class="num">${rs(billTotal(b))}</div><span class="pill ${b.type==='Quotation'?'':'acc'}">${esc(b.type)}</span></div></button>`).join('')}</div>`
    : `<div class="empty"><p class="muted" style="margin:0">No bills for this project yet.</p></div>`}
  </section>
  <section><h2>Account statement</h2>
    ${rows.length ? `<div class="list tbl"><table><thead><tr><th>Date</th><th>Details</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Balance</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-go="${r.kind==='bill'?'bill':'payEdit'}" data-id="${r.id}"><td class="num">${fdate(r.date)}</td><td>${esc(r.text)}</td><td class="n">${r.debit?money(r.debit):''}</td><td class="n">${r.credit?money(r.credit):''}</td><td class="n">${money(r.bal)}</td></tr>`).join('')}
    </tbody></table></div><p class="hint">Tap a payment to correct or delete it. Quotations are not counted in the balance.</p>`
    : `<div class="empty"><p class="muted" style="margin:0">Bills and payments will appear here with a running balance.</p></div>`}
  </section>
  ${delBlock('project', p.id, 'Delete this project', 'This also deletes its bills and payments.')}`;
}
function statement(pid){
  const ev = [
    ...S.bills.filter(b => b.projectId === pid && counts(b)).map(b => ({kind:'bill',id:b.id,date:b.date,k:sortKey(b),text:`${b.type} ${b.no}${b.title?' – '+b.title:''}`,debit:billTotal(b),credit:0})),
    ...S.payments.filter(p => p.projectId === pid).map(p => ({kind:'pay',id:p.id,date:p.date,k:sortKey(p)+'z',text:`Payment – ${p.method||'Cash'}${p.ref?' ('+p.ref+')':''}`,debit:0,credit:n(p.amount)}))
  ].sort((a,b) => a.k.localeCompare(b.k));
  let bal = 0; ev.forEach(e => { bal += e.debit - e.credit; e.bal = bal; });
  return ev;
}
function delBlock(kind, id, label, warn){
  if(view.confirm === id) return `<div class="confirm" style="margin-top:28px"><span>${esc(warn)} This cannot be undone.</span><button class="btn danger sm" data-act="del-${kind}" data-id="${id}">Yes, delete</button><button class="btn sm" data-act="unconfirm">Keep it</button></div>`;
  return `<div style="margin-top:28px"><button class="btn ghost sm" data-act="confirm" data-id="${id}">${esc(label)}</button></div>`;
}
const notFound = () => `<button class="back" data-go="home">← Projects</button><div class="empty"><p class="muted" style="margin:0">This record was deleted or is still loading.</p></div>`;

function groupedItems(b){
  const out = [];
  CATS.forEach(cat => { const its = (b.items||[]).filter(it => (it.cat||'Other') === cat && (it.desc || n(it.qty) || n(it.rate))); if(its.length) out.push({cat, its}); });
  return out;
}
function vBill(){
  const b = byId('bills', view.id); if(!b) return notFound();
  const p = byId('projects', b.projectId) || {}; const c = byId('clients', p.clientId) || {}; const biz = S.settings;
  const groups = groupedItems(b); let i = 0;
  const acct = counts(b) ? accountAt(b) : null;
  const bank = [biz.bank, biz.branch && 'Branch: ' + biz.branch, biz.accName && 'A/C name: ' + biz.accName, biz.accNo && 'A/C no: ' + biz.accNo].filter(Boolean);
  return `<button class="back" data-go="project" data-id="${p.id}">← ${esc(p.name||'Project')}</button>
  <div class="row" style="margin:8px 0 14px">
    ${canShareFiles() ? `<button class="btn pri" data-act="billShare" data-id="${b.id}">Share PDF</button>` : ''}<button class="btn ${canShareFiles()?'':'pri'}" data-act="billPdf" data-id="${b.id}">Download PDF</button>
    <button class="btn" data-act="billText" data-id="${b.id}">Copy for WhatsApp</button>
    <button class="btn" data-act="editBill" data-id="${b.id}">Edit</button>
    <button class="btn" data-act="dupBill" data-id="${b.id}">Copy as new bill</button>
  </div>
  <article class="paper">
    <div class="head">
      <div class="biz"><b>${esc(biz.name || 'Your business name')}</b>
        <div class="muted">${[biz.address, biz.phone, biz.email, biz.reg && 'Reg. no: ' + biz.reg].filter(Boolean).map(esc).join('<br>') || 'Add your details under My business'}</div></div>
      <div class="doc"><div class="kind">${esc(b.type)}</div><div class="num">${esc(b.no)}</div><div class="muted">${fdate(b.date)}</div>${b.example?'<span class="pill ex">Example</span>':''}</div>
    </div>
    <div class="parties">
      <div><div class="eyebrow">Bill to</div><b>${esc(c.name||'')}</b><div class="muted">${[c.address, c.phone].filter(Boolean).map(esc).join('<br>')}</div></div>
      <div><div class="eyebrow">Project / site</div><b>${esc(p.name||'')}</b><div class="muted">${esc(p.site||'')}</div>${b.title?`<div style="margin-top:4px">${esc(b.title)}</div>`:''}</div>
    </div>
    <div class="tbl"><table><thead><tr><th>#</th><th>Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>
      ${groups.map(g => `<tr class="grp"><td colspan="5">${g.cat}</td></tr>` + g.its.map(it => `<tr><td class="muted">${++i}</td><td>${esc(it.desc)}</td><td class="n">${esc(it.qty)} <span class="muted">${esc(it.unit)}</span></td><td class="n">${money(it.rate)}</td><td class="n">${money(lineAmt(it))}</td></tr>`).join('')).join('')}
    </tbody></table></div>
    <div class="sumbox">
      ${CATS.map(cat => { const t = (b.items||[]).filter(it => (it.cat||'Other')===cat).reduce((a,it)=>a+lineAmt(it),0); return t ? `<span class="k">${cat}</span><span class="num">${money(t)}</span>` : ''; }).join('')}
      ${n(b.discount) ? `<span class="k">Less discount</span><span class="num">−${money(b.discount)}</span>` : ''}
      <span class="tot">${b.type==='Quotation'?'Quoted total':'This bill'}</span><span class="tot num">${rs(billTotal(b))}</span>
    </div>
    ${acct ? `<div class="acct"><div class="eyebrow" style="margin-bottom:4px">Project account as at ${fdate(b.date)}</div><div class="sumbox" style="margin-left:0">
      <span class="k">Previous bills</span><span class="num">${money(acct.previous)}</span>
      <span class="k">This bill</span><span class="num">${money(billTotal(b))}</span>
      <span class="k">Paid to date</span><span class="num">−${money(acct.paid)}</span>
      <span class="tot">Balance due</span><span class="tot num" style="color:var(--due)">${rs(acct.balance)}</span></div></div>` : ''}
    ${b.notes || biz.terms ? `<div><div class="eyebrow">Notes</div><div style="white-space:pre-wrap">${esc(b.notes || biz.terms)}</div></div>` : ''}
    ${bank.length ? `<div><div class="eyebrow">Pay to</div><div>${bank.map(esc).join('<br>')}</div></div>` : ''}
    <div class="sign"><div>Authorised signature${biz.owner ? '<br>' + esc(biz.owner) : ''}</div></div>
  </article>
  ${delBlock('bill', b.id, 'Delete this bill', 'This bill will be removed from the project account.')}`;
}

function blankItem(){ return {desc:'',cat:'Material',qty:'',unit:'nos',rate:''}; }
function vBillEdit(){
  if(!draft){
    if(view.id){ const b = byId('bills', view.id); if(!b) return notFound(); draft = JSON.parse(JSON.stringify(b)); }
    else if(view.from){ const s = byId('bills', view.from); draft = JSON.parse(JSON.stringify(s)); delete draft.id; delete draft.createdAt; delete draft.example; draft.date = today(); draft.no = nextNo(draft.type); }
    else { const pid = view.pid || (S.projects.find(p => (p.status||'Active') === 'Active') || S.projects[0] || {}).id; draft = {projectId: pid, type:'Running bill', no: nextNo('Running bill'), date: today(), title:'', items:[blankItem()], discount:'', notes:''}; }
  }
  const d = draft;
  const backTo = d.id ? `data-go="bill" data-id="${d.id}"` : d.projectId && view.pid ? `data-go="project" data-id="${d.projectId}"` : 'data-go="home"';
  return `<button class="back" ${backTo}>← Cancel</button>
  <h1 style="margin:6px 0 14px">${d.id ? 'Edit bill' : 'New bill'}</h1>
  <form class="card" id="billForm">
    <div class="grid2">
      <label class="f">Project<select data-f="projectId" id="b-project" required>${S.projects.map(p => `<option value="${p.id}" ${p.id===d.projectId?'selected':''}>${esc(p.name)} – ${esc((byId('clients',p.clientId)||{}).name||'')}</option>`).join('')}</select></label>
      <label class="f">Type<select data-f="type" id="b-type">${Object.keys(TYPES).map(t => `<option ${t===d.type?'selected':''}>${t}</option>`).join('')}</select></label>
      <label class="f">Bill number<input data-f="no" id="b-no" value="${esc(d.no)}" required></label>
      <label class="f">Date<input type="date" data-f="date" id="b-date" value="${esc(d.date)}" required></label>
    </div>
    <label class="f">Work covered (optional)<input data-f="title" id="b-title" value="${esc(d.title)}" placeholder="e.g. Foundation and DPC level, week of 14 Oct"></label>
    <div><div class="eyebrow" style="margin-bottom:6px">Quick add</div><div class="chips">${PRESETS.map((p,i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.desc)}</button>`).join('')}</div></div>
    <div class="lines">${d.items.map((it,i) => `<div class="line">
      <label class="d">Description<input data-i="${i}" data-if="desc" id="it-${i}-d" value="${esc(it.desc)}" list="descs" placeholder="Item or work done"></label>
      <label class="c">Type<select data-i="${i}" data-if="cat" id="it-${i}-c">${CATS.map(c => `<option ${c===it.cat?'selected':''}>${c}</option>`).join('')}</select></label>
      <label>Qty<input data-i="${i}" data-if="qty" id="it-${i}-q" value="${esc(it.qty)}" inputmode="decimal"></label>
      <label>Unit<select data-i="${i}" data-if="unit" id="it-${i}-u">${UNITS.map(u => `<option ${u===it.unit?'selected':''}>${u}</option>`).join('')}</select></label>
      <label class="rt">Rate (Rs)<input data-i="${i}" data-if="rate" id="it-${i}-r" value="${esc(it.rate)}" inputmode="decimal"></label>
      <div class="amtw" style="display:flex;align-items:end;gap:4px;justify-content:flex-end"><span class="amt" id="amt-${i}"></span><button type="button" class="x" data-rmitem="${i}" aria-label="Remove line">×</button></div>
    </div>`).join('')}</div>
    <datalist id="descs">${PRESETS.map(p => `<option value="${esc(p.desc)}">`).join('')}</datalist>
    <div><button type="button" class="btn sm" data-act="addItem">+ Add line</button></div>
    <div class="grid2">
      <label class="f">Discount (Rs)<input data-f="discount" id="b-disc" value="${esc(d.discount)}" inputmode="decimal"></label>
      <div class="totals" id="totals"></div>
    </div>
    <label class="f">Notes on this bill<textarea data-f="notes" id="b-notes" placeholder="${esc(S.settings.terms || 'e.g. Payment due within 7 days')}">${esc(d.notes)}</textarea></label>
    <div class="row"><button class="btn pri" type="submit">Save bill</button><button class="btn" type="button" ${backTo}>Cancel</button></div>
  </form>`;
}
function recalc(){
  if(!draft) return;
  draft.items.forEach((it,i) => { const e = document.getElementById('amt-'+i); if(e) e.textContent = money(lineAmt(it)); });
  const t = document.getElementById('totals'); if(!t) return;
  const sub = billSub(draft);
  t.innerHTML = `<div><span class="muted">Subtotal</span><span class="num">${money(sub)}</span></div>${n(draft.discount)?`<div><span class="muted">Discount</span><span class="num">−${money(draft.discount)}</span></div>`:''}<div class="big"><span>Total</span><span class="num">${rs(billTotal(draft))}</span></div>`;
}

function vPayEdit(){
  const p0 = view.id ? byId('payments', view.id) : null;
  if(view.id && !p0) return notFound();
  const d = p0 || {projectId: view.pid || (S.projects[0]||{}).id, date: today(), amount:'', method:'Cash', ref:'', note:''};
  const back = d.projectId ? `data-go="project" data-id="${d.projectId}"` : 'data-go="home"';
  const st = d.projectId ? projectStats(d.projectId) : null;
  return `<button class="back" ${back}>← Cancel</button>
  <h1 style="margin:6px 0 14px">${p0 ? 'Edit payment' : 'Record a payment'}</h1>
  <form class="card" id="payForm">
    <label class="f">Project<select name="projectId" id="p-project" required>${S.projects.map(p => `<option value="${p.id}" ${p.id===d.projectId?'selected':''}>${esc(p.name)} – ${esc((byId('clients',p.clientId)||{}).name||'')}</option>`).join('')}</select></label>
    ${st && !p0 ? `<div class="hint">Currently due on this project: <span class="num">${rs(st.balance)}</span></div>` : ''}
    <div class="grid2">
      <label class="f">Amount received (Rs)<input name="amount" id="p-amount" value="${esc(d.amount)}" inputmode="decimal" required></label>
      <label class="f">Date<input type="date" name="date" id="p-date" value="${esc(d.date)}" required></label>
      <label class="f">Paid by<select name="method" id="p-method">${METHODS.map(m => `<option ${m===d.method?'selected':''}>${m}</option>`).join('')}</select></label>
      <label class="f">Cheque / slip no. (optional)<input name="ref" id="p-ref" value="${esc(d.ref)}"></label>
    </div>
    <label class="f">Note (optional)<input name="note" id="p-note" value="${esc(d.note)}" placeholder="e.g. Advance for roof work"></label>
    <div class="row"><button class="btn pri" type="submit">Save payment</button><button class="btn" type="button" ${back}>Cancel</button></div>
  </form>
  ${p0 ? delBlock('payment', p0.id, 'Delete this payment', 'This payment will be removed from the account.') : ''}`;
}

function vProjectEdit(){
  const p = view.id ? byId('projects', view.id) : null;
  if(view.id && !p) return notFound();
  const d = p || {name:'', clientId: view.cid || '', site:'', contractValue:'', start: today(), status:'Active'};
  const back = p ? `data-go="project" data-id="${p.id}"` : 'data-go="home"';
  const noClients = !S.clients.length;
  return `<button class="back" ${back}>← Cancel</button>
  <h1 style="margin:6px 0 14px">${p ? 'Edit project' : 'New project'}</h1>
  <form class="card" id="projForm">
    <label class="f">Client<select name="clientId" id="pr-client">${S.clients.map(c => `<option value="${c.id}" ${c.id===d.clientId?'selected':''}>${esc(c.name)}</option>`).join('')}<option value="__new" ${noClients?'selected':''}>+ New client…</option></select></label>
    <div class="grid2" id="newClient" ${noClients?'':'hidden'}>
      <label class="f">Client name<input name="cname" id="pr-cname" placeholder="e.g. Mr. Nimal Perera"></label>
      <label class="f">Phone<input name="cphone" id="pr-cphone" inputmode="tel" placeholder="07X XXX XXXX"></label>
      <label class="f" style="grid-column:1/-1">Address<input name="caddr" id="pr-caddr"></label>
    </div>
    <label class="f">Project name<input name="name" id="pr-name" value="${esc(d.name)}" required placeholder="e.g. Two-storey house, Kadawatha"></label>
    <label class="f">Site address<input name="site" id="pr-site" value="${esc(d.site)}"></label>
    <div class="grid2">
      <label class="f">Agreed contract value (Rs, optional)<input name="contractValue" id="pr-cv" value="${esc(d.contractValue)}" inputmode="decimal"></label>
      <label class="f">Status<select name="status" id="pr-status">${['Active','On hold','Completed'].map(s => `<option ${s===(d.status||'Active')?'selected':''}>${s}</option>`).join('')}</select></label>
    </div>
    <div class="row"><button class="btn pri" type="submit">Save project</button><button class="btn" type="button" ${back}>Cancel</button></div>
  </form>`;
}

function vClients(){
  const list = [...S.clients].sort((a,b) => (a.name||'').localeCompare(b.name||''));
  return `<section><div class="spread"><h2>Clients</h2><button class="btn pri" data-go="clientEdit">+ New client</button></div>
  ${list.length ? `<div class="list">${list.map(c => {
    const ps = S.projects.filter(p => p.clientId === c.id);
    const bal = ps.reduce((a,p) => a + projectStats(p.id).balance, 0);
    return `<button class="item" data-go="clientEdit" data-id="${c.id}"><div class="main"><div class="t">${esc(c.name)}${isEx(c)}</div><div class="s">${[c.phone, ps.length + ' project' + (ps.length===1?'':'s')].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="r">${bal > 0.005 ? `<div class="num" style="color:var(--due)">${rs(bal)}</div><div class="s">due</div>` : '<span class="pill ok">Nothing due</span>'}</div></button>`; }).join('')}</div>`
  : `<div class="empty"><p class="muted" style="margin:0">No clients yet. You can also add one while creating a project.</p></div>`}</section>`;
}
function vClientEdit(){
  const c = view.id ? byId('clients', view.id) : null;
  if(view.id && !c) return notFound();
  const d = c || {name:'',phone:'',address:'',notes:''};
  const ps = c ? S.projects.filter(p => p.clientId === c.id) : [];
  return `<button class="back" data-go="clients">← Clients</button>
  <h1 style="margin:6px 0 14px">${c ? esc(c.name) : 'New client'}</h1>
  <form class="card" id="clientForm">
    <div class="grid2">
      <label class="f">Name<input name="name" id="c-name" value="${esc(d.name)}" required></label>
      <label class="f">Phone<input name="phone" id="c-phone" value="${esc(d.phone)}" inputmode="tel"></label>
    </div>
    <label class="f">Address<input name="address" id="c-addr" value="${esc(d.address)}"></label>
    <label class="f">Notes<textarea name="notes" id="c-notes">${esc(d.notes)}</textarea></label>
    <div class="row"><button class="btn pri" type="submit">Save client</button>${c ? `<button class="btn" type="button" data-go="projectEdit" data-cid="${c.id}">+ New project for this client</button>` : ''}</div>
  </form>
  ${ps.length ? `<section><h2>Projects</h2><div class="list">${ps.map(projRow).join('')}</div></section>` : ''}
  ${c && !ps.length ? delBlock('client', c.id, 'Delete this client', 'This client will be removed.') : ''}`;
}
function vSettings(){
  const s = S.settings;
  const f = (k, label, ph, extra) => `<label class="f">${label}<input name="${k}" id="s-${k}" value="${esc(s[k])}" placeholder="${esc(ph||'')}" ${extra||''}></label>`;
  return `<h1 style="margin:22px 0 4px">My business</h1><p class="muted" style="margin:0 0 14px">These details print at the top and bottom of every bill.</p>
  <form class="card" id="setForm">
    <div class="grid2">${f('name','Business name','e.g. Perera Constructions')}${f('owner','Your name (signs bills)','')}${f('phone','Phone','07X XXX XXXX','inputmode="tel"')}${f('email','Email','')}</div>
    ${f('address','Business address','')}
    ${f('reg','Business / CIDA registration no. (optional)','')}
    <div class="eyebrow">Bank details for payments</div>
    <div class="grid2">${f('bank','Bank','e.g. Bank of Ceylon')}${f('branch','Branch','')}${f('accName','Account name','')}${f('accNo','Account number','')}</div>
    <label class="f">Default note on bills<textarea name="terms" id="s-terms" placeholder="e.g. Please settle within 7 days. Materials remain our property until paid.">${esc(s.terms)}</textarea></label>
    <div class="row"><button class="btn pri" type="submit">Save details</button></div>
  </form>
  <h2 style="margin-top:28px">Your login</h2>
  <p class="muted" style="margin:4px 0 12px">Login ID: <span class="num">${esc(S.me && S.me.username)}</span></p>
  <form class="card" id="pwForm">
    <div class="grid2">
      <label class="f">Current password<input type="password" name="current" id="pw-cur" autocomplete="current-password" required></label>
      <label class="f">New password<input type="password" name="next" id="pw-new" autocomplete="new-password" minlength="6" required></label>
    </div>
    <div class="row"><button class="btn" type="submit">Change password</button><button class="btn ghost" type="button" data-act="logout">Log out</button></div>
  </form>`;
}

/* ---------- sharing: WhatsApp text and PDF ---------- */
async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast('Copied. Paste it into WhatsApp or SMS.'); }
  catch(e){ $app.insertAdjacentHTML('afterbegin', `<div class="card" style="margin-top:14px"><b>Copy this text</b><textarea id="copybox" style="min-height:220px">${esc(text)}</textarea></div>`); const t = document.getElementById('copybox'); t.focus(); t.select(); }
}
function billText(b){
  const p = byId('projects', b.projectId)||{}, c = byId('clients', p.clientId)||{}, biz = S.settings;
  const L = [`*${biz.name || 'Bill'}*`, `${b.type} ${b.no} · ${fdate(b.date)}`, `To: ${c.name||''}`, `Project: ${p.name||''}`]; if(b.title) L.push(`Work: ${b.title}`); L.push('');
  groupedItems(b).forEach(g => { L.push(`_${g.cat}_`); g.its.forEach(it => L.push(`• ${it.desc}: ${it.qty} ${it.unit} × ${money(it.rate)} = ${money(lineAmt(it))}`)); });
  if(n(b.discount)) L.push(`Discount: −${money(b.discount)}`);
  L.push('', `*${b.type==='Quotation'?'Quoted total':'This bill'}: ${rs(billTotal(b))}*`);
  if(counts(b)){ const a = accountAt(b); L.push(`Previous bills: ${money(a.previous)}`, `Paid to date: ${money(a.paid)}`, `*Balance due: ${rs(a.balance)}*`); }
  const bank = [biz.bank, biz.branch, biz.accName, biz.accNo].filter(Boolean); if(bank.length) L.push('', 'Pay to: ' + bank.join(', '));
  if(biz.phone) L.push(`${biz.owner||''} ${biz.phone}`.trim());
  return L.join('\n');
}
function stmtText(pid){
  const p = byId('projects', pid)||{}, c = byId('clients', p.clientId)||{}, st = projectStats(pid);
  const L = [`*${S.settings.name || 'Account statement'}*`, `Statement for ${c.name||''} – ${p.name||''}`, `As at ${fdate(today())}`, ''];
  statement(pid).forEach(r => L.push(`${fdate(r.date)}  ${r.text}  ${r.debit?'+'+money(r.debit):'−'+money(r.credit)}`));
  L.push('', `Total billed: ${money(st.billed)}`, `Total received: ${money(st.paid)}`, `*Balance due: ${rs(st.balance)}*`);
  return L.join('\n');
}
function pdfBase(title, no, date){
  const {jsPDF} = window.jspdf; const doc = new jsPDF({unit:'mm', format:'a4'}); const biz = S.settings; const M = 14, W = 210;
  doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text(biz.name || 'Your business', M, 18);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(90);
  let y = 23; [biz.address, biz.phone, biz.email, biz.reg && 'Reg. no: ' + biz.reg].filter(Boolean).forEach(t => { doc.text(String(t), M, y, {maxWidth: 110}); y += 4.5; });
  doc.setTextColor(15,107,92); doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text(title.toUpperCase(), W-M, 18, {align:'right'});
  doc.setTextColor(30); doc.setFont('helvetica','normal'); doc.setFontSize(10); if(no) doc.text(no, W-M, 24, {align:'right'}); doc.text(fdate(date), W-M, no?29:24, {align:'right'});
  y = Math.max(y, 32) + 2; doc.setDrawColor(30); doc.setLineWidth(.6); doc.line(M, y, W-M, y);
  return {doc, y: y + 7, M, W};
}
function partyBlock(ctx, c, p, extra){
  const {doc, M} = ctx; let y = ctx.y;
  doc.setFontSize(8); doc.setTextColor(110); doc.text('BILL TO', M, y); doc.text('PROJECT / SITE', 110, y);
  doc.setFontSize(10); doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.text(c.name||'', M, y+5); doc.text(p.name||'', 110, y+5, {maxWidth:86});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80);
  let yl = y+10; [c.address, c.phone].filter(Boolean).forEach(t => { doc.text(String(t), M, yl, {maxWidth:88}); yl += 4.5; });
  let yr = y+10; [p.site, extra].filter(Boolean).forEach(t => { const lines = doc.splitTextToSize(String(t), 86); doc.text(lines, 110, yr); yr += 4.5*lines.length; });
  ctx.y = Math.max(yl, yr) + 4;
}
function sumRows(ctx, rows){
  const {doc, W, M} = ctx; let y = ctx.y;
  if(y > 260){ doc.addPage(); y = 20; }
  rows.forEach(([k, v, strong]) => {
    doc.setFont('helvetica', strong ? 'bold' : 'normal'); doc.setFontSize(strong ? 11 : 9.5); doc.setTextColor(strong ? 20 : 90);
    if(strong){ doc.setDrawColor(30); doc.setLineWidth(.4); doc.line(120, y-4, W-M, y-4); }
    doc.text(k, 122, y); doc.text(v, W-M, y, {align:'right'}); y += strong ? 7 : 5.5;
  });
  ctx.y = y + 2;
}
function footer(ctx, notes){
  const {doc, M, W} = ctx; const biz = S.settings; let y = ctx.y;
  const bank = [biz.bank, biz.branch && 'Branch: ' + biz.branch, biz.accName && 'A/C name: ' + biz.accName, biz.accNo && 'A/C no: ' + biz.accNo].filter(Boolean);
  const block = (h, text) => { const lines = doc.splitTextToSize(text, W-2*M); if(y + 6 + lines.length*4.5 > 275){ doc.addPage(); y = 20; } doc.setFontSize(8); doc.setTextColor(110); doc.setFont('helvetica','bold'); doc.text(h, M, y); doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(40); doc.text(lines, M, y+5); y += 8 + lines.length*4.5; };
  if(notes) block('NOTES', notes);
  if(bank.length) block('PAY TO', bank.join('   |   '));
  if(y > 255){ doc.addPage(); y = 20; }
  y += 14; doc.setDrawColor(120); doc.setLineWidth(.3); doc.line(W-M-60, y, W-M, y); doc.setFontSize(8.5); doc.setTextColor(100);
  doc.text('Authorised signature' + (biz.owner ? ' – ' + biz.owner : ''), W-M-30, y+4.5, {align:'center'});
}
const tableStyle = M => ({margin:{left:M,right:M}, styles:{fontSize:9, cellPadding:2, textColor:30}, headStyles:{fillColor:[15,107,92], textColor:255, fontStyle:'bold'}, theme:'grid'});
function billPdf(b){
  const p = byId('projects', b.projectId)||{}, c = byId('clients', p.clientId)||{};
  const ctx = pdfBase(b.type, b.no, b.date); const {doc, M} = ctx;
  partyBlock(ctx, c, p, b.title);
  let i = 0; const body = [];
  groupedItems(b).forEach(g => { body.push([{content: g.cat.toUpperCase(), colSpan: 6, styles:{fillColor:[238,242,240], fontStyle:'bold', fontSize:8, textColor:90}}]); g.its.forEach(it => body.push([++i, it.desc||'', it.qty||'', it.unit||'', money(it.rate), money(lineAmt(it))])); });
  doc.autoTable({...tableStyle(M), startY: ctx.y, head:[['#','Description','Qty','Unit','Rate (Rs)','Amount (Rs)']], body,
    columnStyles:{0:{cellWidth:8}, 2:{halign:'right', cellWidth:16}, 3:{cellWidth:18}, 4:{halign:'right', cellWidth:26}, 5:{halign:'right', cellWidth:30}}});
  ctx.y = doc.lastAutoTable.finalY + 8;
  const rows = []; CATS.forEach(cat => { const t = (b.items||[]).filter(it => (it.cat||'Other')===cat).reduce((a,it)=>a+lineAmt(it),0); if(t) rows.push([cat, money(t)]); });
  if(n(b.discount)) rows.push(['Less discount', '-' + money(b.discount)]);
  rows.push([b.type==='Quotation' ? 'Quoted total' : 'This bill', rs(billTotal(b)), true]);
  sumRows(ctx, rows);
  if(counts(b)){ const a = accountAt(b); ctx.y += 2; sumRows(ctx, [['Previous bills', money(a.previous)], ['This bill', money(billTotal(b))], ['Paid to date', '-' + money(a.paid)], ['BALANCE DUE', rs(a.balance), true]]); }
  footer(ctx, b.notes || S.settings.terms);
  return doc.output('arraybuffer');
}
function stmtPdf(pid){
  const p = byId('projects', pid)||{}, c = byId('clients', p.clientId)||{}, st = projectStats(pid);
  const ctx = pdfBase('Statement', '', today()); const {doc, M} = ctx;
  partyBlock(ctx, c, p, n(p.contractValue) ? 'Contract value: ' + rs(p.contractValue) : '');
  doc.autoTable({...tableStyle(M), startY: ctx.y, head:[['Date','Details','Billed (Rs)','Received (Rs)','Balance (Rs)']],
    body: statement(pid).map(r => [fdate(r.date), r.text, r.debit?money(r.debit):'', r.credit?money(r.credit):'', money(r.bal)]),
    columnStyles:{0:{cellWidth:24}, 2:{halign:'right', cellWidth:28}, 3:{halign:'right', cellWidth:28}, 4:{halign:'right', cellWidth:30}}});
  ctx.y = doc.lastAutoTable.finalY + 8;
  sumRows(ctx, [['Total billed', money(st.billed)], ['Total received', money(st.paid)], ['BALANCE DUE', rs(st.balance), true]]);
  footer(ctx, '');
  return doc.output('arraybuffer');
}
function canShareFiles(){ try{ return !!(navigator.canShare && navigator.canShare({files:[new File([''], 'x.pdf', {type:'application/pdf'})]})); }catch(e){ return false; } }
const pdfName = s => s.replace(/[^\w.\- ]+/g,'_').trim() + '.pdf';
async function savePdf(make, filename, share){
  if(!window.jspdf || !window.jspdf.jsPDF){ toast('The PDF maker did not load. Reload the page.'); return; }
  const blob = new Blob([make()], {type:'application/pdf'});
  if(share){
    try{ await navigator.share({files:[new File([blob], pdfName(filename), {type:'application/pdf'})], title: filename}); }
    catch(e){ if(e && e.name !== 'AbortError') toast('Could not open sharing. Use Download PDF instead.'); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = pdfName(filename);
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-act],[data-filter],[data-preset],[data-rmitem]'); if(!t) return;
  const id = t.dataset.id;
  if(t.dataset.filter){ filter = t.dataset.filter; render(); return; }
  if(t.dataset.preset !== undefined){ const pr = PRESETS[+t.dataset.preset]; const last = draft.items[draft.items.length-1]; const it = {...blankItem(), desc:pr.desc, cat:pr.cat, unit:pr.unit};
    if(last && !last.desc && !n(last.qty) && !n(last.rate)) draft.items[draft.items.length-1] = it; else draft.items.push(it); render(); const q = document.getElementById('it-'+(draft.items.length-1)+'-q'); if(q) q.focus(); return; }
  if(t.dataset.rmitem !== undefined){ draft.items.splice(+t.dataset.rmitem, 1); if(!draft.items.length) draft.items.push(blankItem()); render(); return; }
  if(t.dataset.go){ go(t.dataset.go, {id, cid: t.dataset.cid}); return; }
  const a = t.dataset.act;
  if(a === 'newBill'){ if(!S.projects.length){ go('projectEdit'); return; } go('billEdit', {pid: id}); }
  else if(a === 'newPay'){ go('payEdit', {pid: id}); }
  else if(a === 'editBill'){ go('billEdit', {id}); }
  else if(a === 'dupBill'){ go('billEdit', {from: id}); }
  else if(a === 'addItem'){ const last = draft.items[draft.items.length-1]; draft.items.push({...blankItem(), cat: last ? last.cat : 'Material'}); render(); const d = document.getElementById('it-'+(draft.items.length-1)+'-d'); if(d) d.focus(); }
  else if(a === 'confirm'){ view.confirm = id; render(); }
  else if(a === 'unconfirm'){ view.confirm = null; render(); }
  else if(a === 'billText'){ copy(billText(byId('bills', id))); }
  else if(a === 'stmtText'){ copy(stmtText(id)); }
  else if(a === 'billPdf' || a === 'billShare'){ const b = byId('bills', id); const c = (byId('clients', (byId('projects', b.projectId)||{}).clientId)||{}).name || ''; savePdf(() => billPdf(b), `${b.no} ${c}`, a === 'billShare'); }
  else if(a === 'stmtPdf' || a === 'stmtShare'){ const p = byId('projects', id); savePdf(() => stmtPdf(id), `Statement ${p.name}`, a === 'stmtShare'); }
  else if(a === 'logout'){ try{ await api('POST', '/api/logout'); }catch(e){} location.href = '/login'; }
  else if(a === 'del-bill'){ const b = byId('bills', id); await remove('bills', id); toast('Bill deleted.'); go('project', {id: b.projectId}); }
  else if(a === 'del-payment'){ const p = byId('payments', id); await remove('payments', id); toast('Payment deleted.'); go('project', {id: p.projectId}); }
  else if(a === 'del-client'){ await remove('clients', id); toast('Client deleted.'); go('clients'); }
  else if(a === 'del-project'){
    for(const b of S.bills.filter(x => x.projectId === id)) await remove('bills', b.id);
    for(const p of S.payments.filter(x => x.projectId === id)) await remove('payments', p.id);
    await remove('projects', id); toast('Project deleted.'); go('home');
  }
});
document.addEventListener('input', e => {
  const t = e.target; if(!draft) return;
  if(t.dataset.f){ draft[t.dataset.f] = t.value; if(t.dataset.f === 'discount') recalc(); }
  else if(t.dataset.if){ const it = draft.items[+t.dataset.i]; it[t.dataset.if] = t.value;
    if(t.dataset.if === 'desc'){ const pr = PRESETS.find(p => p.desc === t.value); if(pr){ it.cat = pr.cat; it.unit = pr.unit; document.getElementById('it-'+t.dataset.i+'-c').value = pr.cat; document.getElementById('it-'+t.dataset.i+'-u').value = pr.unit; } }
    recalc(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if(t.id === 'pr-client') document.getElementById('newClient').hidden = t.value !== '__new';
  if(t.id === 'b-type' && draft && !draft.id){ draft.no = nextNo(t.value); document.getElementById('b-no').value = draft.no; }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, fd = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try{
    if(f.id === 'billForm'){
      if(!draft.projectId){ toast('Pick a project first.'); return; }
      draft.items = draft.items.filter(it => it.desc || n(it.qty) || n(it.rate));
      if(!draft.items.length){ draft.items.push(blankItem()); toast('Add at least one line.'); return; }
      const id = await put('bills', draft);
      const p = byId('projects', draft.projectId); if(p) await put('projects', p);
      toast('Bill saved.'); go('bill', {id});
    } else if(f.id === 'payForm'){
      if(!(n(fd.amount) > 0)){ toast('Enter the amount received.'); return; }
      const old = view.id ? byId('payments', view.id) : {};
      await put('payments', {...old, ...fd, amount: n(fd.amount)});
      const p = byId('projects', fd.projectId); if(p) await put('projects', p);
      toast('Payment saved.'); go('project', {id: fd.projectId});
    } else if(f.id === 'projForm'){
      let clientId = fd.clientId;
      if(clientId === '__new'){ if(!fd.cname.trim()){ toast('Enter the client name.'); return; } clientId = await put('clients', {name: fd.cname.trim(), phone: fd.cphone, address: fd.caddr}); }
      const old = view.id ? byId('projects', view.id) : {};
      const id = await put('projects', {...old, name: fd.name.trim(), site: fd.site, contractValue: fd.contractValue, status: fd.status, clientId});
      toast('Project saved.'); go('project', {id});
    } else if(f.id === 'clientForm'){
      const old = view.id ? byId('clients', view.id) : {};
      await put('clients', {...old, ...fd, name: fd.name.trim()}); toast('Client saved.'); go('clients');
    } else if(f.id === 'pwForm'){
      await api('POST', '/api/me/password', fd); f.reset(); toast('Password changed.');
    } else if(f.id === 'setForm'){
      await putSettings({...S.settings, ...fd}); toast('Details saved.'); render();
    }
  }catch(err){ /* toast already shown */ }
  finally{ btn.disabled = false; }
});

render();
init();
