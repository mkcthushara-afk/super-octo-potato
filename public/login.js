document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('err'), btn = document.getElementById('go');
  err.textContent = ''; btn.disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-SBB': '1'},
      body: JSON.stringify({username: document.getElementById('username').value.trim(), password: document.getElementById('password').value}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || 'Could not log in. Try again.'; return; }
    location.href = d.role === 'admin' ? '/admin' : '/app';
  } catch (x) {
    err.textContent = 'No connection. Check your internet and try again.';
  } finally { btn.disabled = false; }
});
