"use strict";
(() => {
  const params = new URLSearchParams(location.search);
  const requested = String(params.get('dashboard') || '').toLowerCase();
  if (!['user','reseller'].includes(requested)) return;

  const userToken = localStorage.getItem('worldnet_token');
  let user = {};
  try { user = JSON.parse(localStorage.getItem('worldnet_user') || '{}'); } catch (_) {}
  const actualRole = user.role === 'reseller' ? 'reseller' : 'user';
  const hasSession = Boolean(userToken);
  if (!hasSession) {
    const target = `ai-builder.html?dashboard=${requested}`;
    sessionStorage.setItem('worldnet_return_to', target);
    localStorage.setItem('worldnet_return_to', target);
    location.replace(`signin.html?next=${encodeURIComponent(target)}`);
    return;
  }

  const role = actualRole;
  if (role !== requested) {
    location.replace(`ai-builder.html?dashboard=${role}`);
    return;
  }

  const menus = {
    user: [
      ['dashboard.html','Overview'],['dashboard-register-domain.html','Register Domain'],
      ['dashboard-dns-manager.html','DNS Manager'],['dashboard-business-email.html','Business Email'],
      ['dashboard-transfer-domain.html','Transfer Domain'],['dashboard-receive-domain.html','Receive Domain'],
      ['dashboard-wallet.html','Banking'],['ai-builder.html?dashboard=user','AI Builder'],
      ['dashboard-support.html','Support']
    ],
    reseller: [
      ['dashboard.html','Overview'],['dashboard-domain-api.html',"Domain Reseller API KEY's"],
      ['dashboard-bank-api.html',"Banking API KEY's"],['dashboard-register-domain.html','Register Domain'],
      ['dashboard-dns-manager.html','DNS Manager'],['dashboard-business-email.html','Business Email'],
      ['dashboard-transfer-domain.html','Transfer Domain'],['dashboard-receive-domain.html','Receive Domain'],
      ['dashboard-wallet.html','Banking'],['ai-builder.html?dashboard=reseller','AI Builder'],
      ['dashboard-support.html','Support']
    ],
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
  const portal = role === 'reseller' ? 'Users Dashboard' : 'Customer Portal';
  const home = role === 'reseller' ? 'dashboard.html' : 'dashboard.html';
  const logout = 'logoutUser()';
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
