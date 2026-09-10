"use strict";
(() => {
  const params = new URLSearchParams(location.search);
  const requested = String(params.get('dashboard') || '').toLowerCase();
  if (!['user','reseller','admin'].includes(requested)) return;

  const userToken = localStorage.getItem('worldnet_token');
  const adminToken = localStorage.getItem('worldnet_admin_token');
  let user = {};
  try { user = JSON.parse(localStorage.getItem('worldnet_user') || '{}'); } catch (_) {}
  let admin = {};
  try { admin = JSON.parse(localStorage.getItem('worldnet_admin_user') || '{}'); } catch (_) {}

  const actualRole = adminToken ? 'admin' : 'reseller';
  const hasSession = requested === 'admin' ? Boolean(adminToken) : Boolean(userToken);
  if (!hasSession) {
    const target = `ai-builder.html?dashboard=${requested}`;
    sessionStorage.setItem('worldnet_return_to', target);
    localStorage.setItem('worldnet_return_to', target);
    location.replace(requested === 'admin' ? 'admin-login.html' : `reseller-signin.html?next=${encodeURIComponent(target)}`);
    return;
  }

  const role = actualRole;
  if (role !== requested) {
    location.replace(`ai-builder.html?dashboard=${role}`);
    return;
  }

  const menus = {
    user: [
      ['dashboard-wallet.html','WNH Bank'],['dashboard-register-domain.html','Register Domain'],
      ['dashboard-dns-manager.html','DNS Manager'],['dashboard-business-email.html','Business Email'],
      ['dashboard-transfer-domain.html','Transfer Domain'],['dashboard-receive-domain.html','Receive Domain'],
      ['reseller-dashboard.html','Overview'],['ai-builder.html?dashboard=reseller','AI Builder'],
      ['dashboard-support.html','Support'],['reseller-bank-api.html',"Banking API KEY's"],
      ['reseller-domain-api.html',"Domain Reseller API KEY's"]
    ],
    reseller: [
      ['dashboard-wallet.html','WNH Bank'],['dashboard-register-domain.html','Register Domain'],
      ['dashboard-dns-manager.html','DNS Manager'],['dashboard-business-email.html','Business Email'],
      ['dashboard-transfer-domain.html','Transfer Domain'],['dashboard-receive-domain.html','Receive Domain'],
      ['reseller-dashboard.html','Overview'],['ai-builder.html?dashboard=reseller','AI Builder'],
      ['dashboard-support.html','Support'],['reseller-bank-api.html',"Banking API KEY's"],
      ['reseller-domain-api.html',"Domain Reseller API KEY's"]
    ],
    admin: [
      ['admin-dashboard.html','Overview'],['admin-dashboard.html#admin-orders','Orders'],
      ['admin-dashboard.html#admin-wallets','Wallets'],['admin-dashboard.html#admin-domains','Domain Activity'],
      ['ai-builder.html?dashboard=admin','AI Builder'],['admin-dashboard.html#admin-support','Support']
    ]
  };

  const publicHeader = document.querySelector('header.top-nav');
  const footer = document.querySelector('footer.site-footer');
  if (publicHeader) publicHeader.remove();
  if (footer) footer.remove();

  document.body.classList.add('dashboard-body','ai-builder-dashboard-mode');
  const content = Array.from(document.body.children).filter(node =>
    !node.matches('script') && !node.classList.contains('dashboard-menu-backdrop')
  );

  const shell = document.createElement('main');
  shell.className = 'app-shell';
  const portal = role === 'admin' ? 'Admin Portal' : 'Account Portal';
  const home = role === 'admin' ? 'admin-dashboard.html' : role === 'reseller' ? 'reseller-dashboard.html' : 'reseller-dashboard.html';
  const logout = role === 'admin' ? 'logoutAdmin()' : 'logoutUser()';
  shell.innerHTML = `
    <aside class="app-sidebar" aria-label="${portal} navigation">
      <a class="app-brand" href="${home}"><img src="images/logo1.jpeg" alt="World Net Hosting logo"><span class="app-brand-copy"><strong>WNH</strong><small>${portal}</small></span></a>
      <div class="app-nav-viewport"><nav class="app-nav">${menus[role].map(([href,label]) => `<a href="${href}" class="${label === 'AI Builder' ? 'active' : ''}">${label}</a>`).join('')}</nav></div>
      <button class="app-logout" type="button" onclick="${logout}">Logout</button>
    </aside>
    <section class="app-main">
      <header class="app-topbar"><div><p class="app-kicker">${portal}</p><h1>AI Builder</h1></div><div class="app-top-actions"><a class="profile-chip" href="${home}">Dashboard</a></div></header>
      <div class="ai-dashboard-content"></div>
    </section>`;
  document.body.insertBefore(shell, document.body.firstChild);
  const target = shell.querySelector('.ai-dashboard-content');
  content.forEach(node => target.appendChild(node));
})();
