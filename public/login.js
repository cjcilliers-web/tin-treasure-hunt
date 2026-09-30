/* Shared sign-in / sign-up box used on the homepage and every destination page.
   Both point at the same /api/auth endpoints and the same tin_users table. */
'use strict';
(function () {
  const box = document.getElementById('authbox');
  if (!box) return;
  const dest = box.dataset.destination || '';
  const next = new URLSearchParams(location.search).get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : `/app${dest ? `?d=${dest}` : ''}`;
  let mode = 'login';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
    if (d.user) {
      box.innerHTML = `<h2>Welcome back, ${esc(d.user.name.split(' ')[0])}</h2><a class="btn" href="${esc(target)}">Start hunting</a><button class="linkbtn" id="so">Not you? Sign out</button>`;
      document.getElementById('so').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.reload(); };
    } else draw();
  }).catch(draw);

  function draw() {
    const signup = mode === 'signup';
    box.innerHTML = `<h2>${signup ? 'Create your explorer account' : 'Sign in'}</h2>
      <p class="note">One TIN account works on every island and every TIN page.</p>
      <form class="form" id="lf">
        ${signup ? '<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>' : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        ${signup ? '<label>Language<select name="language"><option value="en">English</option><option value="es">Español</option></select></label>' : ''}
        <div class="err" id="le" role="alert"></div>
        <button class="btn" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <button class="linkbtn" id="sw">${signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>`;
    document.getElementById('sw').onclick = () => { mode = signup ? 'login' : 'signup'; draw(); };
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (dest) f.destination = dest;
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await fetch(`/api/auth/${signup ? 'register' : 'login'}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Something went wrong');
        location.href = target;
      } catch (err) { document.getElementById('le').textContent = err.message; btn.disabled = false; }
    };
  }
})();
