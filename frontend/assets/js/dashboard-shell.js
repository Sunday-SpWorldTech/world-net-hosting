"use strict";
(() => {
  const init = () => {
    const body = document.body;
    const sidebar = document.querySelector('.app-sidebar');
    const topbar = document.querySelector('.app-topbar');
    if (!body || !sidebar || !topbar) return;

    let viewport = sidebar.querySelector('.app-nav-viewport');
    const nav = sidebar.querySelector('.app-nav');
    if (!viewport && nav) {
      viewport = document.createElement('div');
      viewport.className = 'app-nav-viewport';
      nav.parentNode.insertBefore(viewport, nav);
      viewport.appendChild(nav);
    }

    const currentUser = (() => {
      try {
        return JSON.parse(localStorage.getItem('worldnet_user') || '{}');
      } catch { return {}; }
    })();

    if (nav) {
      const page = (location.pathname.split('/').pop() || '').toLowerCase();
      const roleMenus = {
        reseller: [
          ['dashboard.html','Overview'],
          ['dashboard-wallet.html','Banking'],
          ['dashboard-register-domain.html','Register Domain'],
          ['dashboard-dns-manager.html','DNS Manager'],
          ['dashboard-business-email.html','Business Email'],
          ['dashboard-transfer-domain.html','Transfer Domain'],
          ['dashboard-receive-domain.html','Receive Domain'],
          ['ai-builder.html?dashboard=reseller','AI Builder'],
          ['dashboard-support.html','Support'],
          ['dashboard-domain-api.html','Domain API Keys'],
          ['dashboard-bank-api.html','Banking API Keys']
        ],
      };
      const menuRole = currentUser.role === 'reseller' ? 'reseller' : 'user';
      const items = roleMenus[menuRole];
      if (items) {
        nav.innerHTML = items.map(([href,label]) => {
          const hrefPage = href.split('#')[0].split('?')[0].toLowerCase();
          const active = page === hrefPage || (page.startsWith('wallet-') && label === 'Banking Transfers');
          return `<a href="${href}" class="${active ? 'active' : ''}">${label}</a>`;
        }).join('');
        const small = sidebar.querySelector('.app-brand-copy small');
        const brand = sidebar.querySelector('.app-brand');
        if (menuRole === 'reseller') {
          if (small) small.textContent = 'Users Dashboard';
          if (brand) brand.href = 'dashboard.html';
        }
      }
    }


    const role = currentUser.role === 'reseller' ? 'reseller' : 'user';
    sidebar.querySelectorAll('a[href^="ai-builder.html"]').forEach(link => {
      link.href = `ai-builder.html?dashboard=${role}`;
    });

    if (!sidebar.querySelector('.app-sidebar-close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-sidebar-close';
      close.setAttribute('aria-label','Close dashboard menu');
      close.innerHTML = '<span aria-hidden="true">×</span><span>Close Menu</span>';
      sidebar.insertBefore(close, sidebar.firstChild);
    }

    let menuButton = topbar.querySelector('.app-mobile-menu-button');
    if (!menuButton) {
      menuButton = document.createElement('button');
      menuButton.type = 'button';
      menuButton.className = 'app-mobile-menu-button';
      menuButton.setAttribute('aria-expanded','false');
      menuButton.setAttribute('aria-label','Open dashboard menu');
      menuButton.innerHTML = '<span class="menu-icon" aria-hidden="true">☰</span><span class="menu-label">Menu</span>';
      topbar.appendChild(menuButton);
    }

    let backdrop = document.querySelector('.dashboard-menu-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'dashboard-menu-backdrop';
      backdrop.setAttribute('aria-label','Close dashboard menu');
      document.body.appendChild(backdrop);
    }

    const openMenu = () => {
      body.classList.add('dashboard-menu-open');
      menuButton.setAttribute('aria-expanded','true');
    };
    const closeMenu = () => {
      body.classList.remove('dashboard-menu-open');
      menuButton.setAttribute('aria-expanded','false');
    };

    menuButton.addEventListener('click', () => body.classList.contains('dashboard-menu-open') ? closeMenu() : openMenu());
    sidebar.querySelector('.app-sidebar-close')?.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);
    sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    window.addEventListener('pageshow', closeMenu);

    const active = nav?.querySelector('a.active');
    if (active && viewport) requestAnimationFrame(() => active.scrollIntoView({ block:'nearest' }));

    // Keep normal mouse-wheel and trackpad scrolling available inside every dashboard menu.
    if (viewport) {
      sidebar.addEventListener('wheel', event => {
        if (!viewport.contains(event.target) && !event.target.closest('.app-nav-scroll-controls')) return;
        const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        if (maxScroll <= 0) return;
        const before = viewport.scrollTop;
        viewport.scrollTop += event.deltaY;
        if (viewport.scrollTop !== before) event.preventDefault();
      }, { passive:false });
    }

    // Bind dashboard logout directly so Banking pages do not depend on an inline handler.
    sidebar.querySelectorAll('.app-logout').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.logoutUser === 'function') {
          window.logoutUser();
          return;
        }
        ['worldnet_token','worldnet_user','worldnet_pin_mode','worldnet_pin_ok','worldnet_return_to']
          .forEach(key => localStorage.removeItem(key));
        sessionStorage.removeItem('worldnet_return_to');
        window.location.replace('signin.html');
      });
    });

    document.querySelectorAll('iframe[data-dashboard-embed]').forEach(frame => {
      frame.addEventListener('load', () => {
        try {
          const doc = frame.contentDocument;
          if (!doc) return;
          doc.documentElement.classList.add('dashboard-embedded');
          doc.body?.classList.add('dashboard-embedded-body');
          doc.querySelectorAll('header.top-nav,header.site-header,.search-strip,footer.site-footer,.contact-floating,.public-dashboard-actions').forEach(node => node.remove());
        } catch (_) {}
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
