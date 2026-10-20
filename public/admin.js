const $app = document.getElementById('app');
let accounts = [], me = null, editing = null, created = null, query = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fdate = iso => iso ? new Date(iso).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) : 'Never';
const displayName = a => a.companyName || a.personName;
function toast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2600); }

async function api(method, url, body){
  let r;
  try{ r = await fetch(url, {method, credentials:'same-origin', headers:{'Content-Type':'application/json','X-SBB':'1'}, body: body ? JSON.stringify(body) : undefined}); }
  catch(e){ throw new Error('No connection. Check your internet and try again.'); }
  if(r.status === 401){ location.href = '/login'; throw new Error('Please log in.'); }
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error || 'Something went wrong. Try again.');
  return d;
}

// Login IDs come from the company name, or the person's name when there is no company.
function suggestId(name){
  let base = name.toLowerCase().replace(/\b(pvt|ltd|private|limited|mr|mrs|ms|miss|dr)\b\.?/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30) || 'contractor';
  if(base.length < 3) base += '.lk';
  let id = base, i = 2;
  while(accounts.some(a => a.username === id)) id = base + i++;
  return id;
}
function suggestPassword(){
  const words = ['brick','cement','sand','metal','beam','slab','roof','tile','door','stair','pillar','wall'];
  const r = crypto.getRandomValues(new Uint32Array(3));
  return words[r[0] % words.length] + '-' + words[r[1] % words.length] + '-' + (1000 + r[2] % 9000);
}
function loginMessage(a, password){
  return `Your Site Bill Book login\n\nLink: ${location.origin}/login\nLogin ID: ${a.username}\nPassword: ${password}\n\nYou can change the password after logging in, under "My business".`;
}

async function load(){
  try{
    [accounts, me] = await Promise.all([api('GET', '/api/admin/accounts'), api('GET', '/api/me')]);
    render();
  }catch(e){ $app.innerHTML = `<div class="empty" style="margin-top:24px"><p class="muted" style="margin:0">${esc(e.message)}</p></div>`; }
}

function render(){
  const q = query.toLowerCase();
  const list = accounts.filter(a => !q || [a.companyName, a.personName, a.username, a.phone, a.address].join(' ').toLowerCase().includes(q));
  const active = accounts.filter(a => a.active).length;
  $app.innerHTML = `<div class="fade">
  <div class="tiles">
    <div class="tile"><div class="eyebrow">Contractors</div><div class="v">${accounts.length}</div></div>
    <div class="tile"><div class="eyebrow">Active</div><div class="v">${active}</div></div>
    <div class="tile"><div class="eyebrow">Bills made</div><div class="v">${accounts.reduce((s, a) => s + a.bills, 0)}</div></div>
  </div>
  ${created ? `<section><div class="card">
    <h2>${created.reset ? 'New password for' : 'Login created for'} ${esc(displayName(created.account))}</h2>
    <p class="muted" style="margin:0">Send these details to the contractor. The password is shown only now.</p>
    <div class="secret" style="white-space:pre-wrap">${esc(loginMessage(created.account, created.password))}</div>
    <div class="row"><button class="btn pri" data-act="copyLogin">Copy for WhatsApp</button><button class="btn ghost" data-act="closeCreated">Done</button></div>
  </div></section>` : ''}
  <section>
    <h2>Add a contractor</h2>
    <form class="card" id="addForm" autocomplete="off">
      <div class="grid2">
        <label class="f">Company name (optional)<input name="companyName" id="a-company" placeholder="e.g. Perera Constructions"></label>
        <label class="f">Contractor's name<input name="personName" id="a-person" required placeholder="e.g. K. A. Nimal Perera"></label>
      </div>
      <label class="f">Address<input name="address" id="a-address" required></label>
      <div class="grid2">
        <label class="f">Phone<input name="phone" id="a-phone" inputmode="tel" placeholder="07X XXX XXXX"></label>
        <label class="f">Login ID<input name="username" id="a-username" required autocapitalize="none" spellcheck="false" pattern="[a-z0-9][a-z0-9._\\-]{2,39}"><span class="hint">Made from the company name, or the person's name if there is no company. You can change it.</span></label>
      </div>
      <label class="f">Password<span class="row" style="flex-wrap:nowrap"><input name="password" id="a-password" required minlength="6" class="num"><button class="btn sm" type="button" data-act="suggestPw">Suggest</button></span></label>
      <p class="err" id="addErr" role="alert"></p>
      <div class="row"><button class="btn pri" type="submit">Create login</button></div>
    </form>
  </section>
  <section>
    <div class="spread"><h2>Contractors</h2>${accounts.length > 5 ? `<input id="search" placeholder="Search" value="${esc(query)}" style="max-width:220px">` : ''}</div>
    ${!accounts.length ? '<div class="empty"><p class="muted" style="margin:0">No contractors yet. Add the first one above.</p></div>'
      : `<div class="list">${list.map(row).join('') || '<div class="item"><span class="muted">No match.</span></div>'}</div>`}
  </section>
  <section>
    <h2>Your admin login</h2>
    <p class="muted" style="margin:0">Login ID: <span class="num">${esc(me && me.username)}</span></p>
    <form class="card" id="pwForm">
      <div class="grid2">
        <label class="f">Current password<input type="password" name="current" id="pw-cur" autocomplete="current-password" required></label>
        <label class="f">New password<input type="password" name="next" id="pw-new" autocomplete="new-password" minlength="6" required></label>
      </div>
      <div class="row"><button class="btn" type="submit">Change my password</button></div>
    </form>
  </section></div>`;
  const pw = document.getElementById('a-password'); if(pw && !pw.value) pw.value = suggestPassword();
}

function row(a){
  if(editing === a.id) return `<form class="card" id="editForm" data-id="${a.id}" style="border:0;border-top:1px solid var(--line);border-radius:0">
    <div class="spread"><b>${esc(displayName(a))}</b><span class="num muted">${esc(a.username)}</span></div>
    <div class="grid2">
      <label class="f">Company name (optional)<input name="companyName" id="e-company" value="${esc(a.companyName)}"></label>
      <label class="f">Contractor's name<input name="personName" id="e-person" value="${esc(a.personName)}" required></label>
    </div>
    <label class="f">Address<input name="address" id="e-address" value="${esc(a.address)}" required></label>
    <div class="grid2">
      <label class="f">Phone<input name="phone" id="e-phone" value="${esc(a.phone)}" inputmode="tel"></label>
      <label class="f">New password (leave empty to keep)<input name="password" id="e-password" minlength="6" class="num" autocomplete="off"></label>
    </div>
    <p class="err" id="editErr" role="alert"></p>
    <div class="row">
      <button class="btn pri" type="submit">Save</button>
      <button class="btn" type="button" data-act="toggle" data-id="${a.id}">${a.active ? 'Switch off login' : 'Switch login back on'}</button>
      <button class="btn ghost" type="button" data-act="cancel">Cancel</button>
    </div>
  </form>`;
  return `<button class="item" data-act="edit" data-id="${a.id}">
    <div class="main"><div class="t">${esc(displayName(a))}</div>
      <div class="s">${[a.companyName ? a.personName : '', a.phone, a.address].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="s">Login ID <span class="num">${esc(a.username)}</span> · last login ${fdate(a.lastLoginAt)}</div></div>
    <div class="r">${a.active ? '<span class="pill ok">Active</span>' : '<span class="pill due">Switched off</span>'}<div class="s">${a.projects} projects · ${a.bills} bills</div></div>
  </button>`;
}

async function copyText(text){
  try{ await navigator.clipboard.writeText(text); toast('Copied. Paste it into WhatsApp or SMS.'); }
  catch(e){ toast('Copy the details from the box by hand.'); }
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]'); if(!t) return;
  const a = t.dataset.act, id = t.dataset.id;
  if(a === 'logout'){ try{ await api('POST', '/api/logout'); }catch(x){} location.href = '/login'; }
  else if(a === 'suggestPw'){ document.getElementById('a-password').value = suggestPassword(); }
  else if(a === 'copyLogin'){ copyText(loginMessage(created.account, created.password)); }
  else if(a === 'closeCreated'){ created = null; render(); }
  else if(a === 'edit'){ editing = id; render(); }
  else if(a === 'cancel'){ editing = null; render(); }
  else if(a === 'toggle'){
    const acct = accounts.find(x => x.id === id);
    try{ const upd = await api('PATCH', `/api/admin/accounts/${id}`, {active: !acct.active}); Object.assign(acct, upd); toast(upd.active ? 'Login switched back on.' : 'Login switched off.'); render(); }
    catch(x){ toast(x.message); }
  }
});

// Fill the login ID from the company name, or the person's name, until the admin types their own.
let idTouched = false;
document.addEventListener('input', e => {
  if(e.target.id === 'search'){ query = e.target.value; const pos = e.target.selectionStart; render(); const s = document.getElementById('search'); s.focus(); s.setSelectionRange(pos, pos); return; }
  if(e.target.id === 'a-username'){ idTouched = !!e.target.value; return; }
  if((e.target.id === 'a-company' || e.target.id === 'a-person') && !idTouched){
    const name = document.getElementById('a-company').value.trim() || document.getElementById('a-person').value.trim();
    document.getElementById('a-username').value = name ? suggestId(name) : '';
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, fd = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try{
    if(f.id === 'addForm'){
      fd.username = fd.username.trim().toLowerCase();
      const acct = await api('POST', '/api/admin/accounts', fd);
      accounts.unshift({...acct, bills: 0, projects: 0});
      created = {account: acct, password: fd.password}; idTouched = false;
      render(); window.scrollTo(0, 0);
    } else if(f.id === 'editForm'){
      const upd = await api('PATCH', `/api/admin/accounts/${f.dataset.id}`, fd);
      Object.assign(accounts.find(x => x.id === f.dataset.id), upd);
      if(fd.password) created = {account: upd, password: fd.password, reset: true};
      editing = null; toast(fd.password ? 'Saved. The new password is shown at the top.' : 'Saved.'); render();
      if(fd.password) window.scrollTo(0, 0);
    } else if(f.id === 'pwForm'){
      await api('POST', '/api/me/password', fd); f.reset(); toast('Password changed.');
    }
  }catch(x){
    const err = f.querySelector('.err'); if(err) err.textContent = x.message; else toast(x.message);
  }finally{ btn.disabled = false; }
});

load();
