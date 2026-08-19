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
        const admin = JSON.parse(localStorage.getItem('worldnet_admin_user') || '{}');
        if (localStorage.getItem('worldnet_admin_token')) return { ...admin, role: 'admin' };
        return JSON.parse(localStorage.getItem('worldnet_user') || '{}');
      } catch { return {}; }
    })();

    if (nav) {
      const page = (location.pathname.split('/').pop() || '').toLowerCase();
      const roleMenus = {
        reseller: [
          ['dashboard-wallet.html','WNH Bank'],
          ['dashboard-register-domain.html','Register Domain'],
          ['dashboard-dns-manager.html','DNS Manager'],
          ['dashboard-business-email.html','Business Email'],
          ['dashboard-transfer-domain.html','Transfer Domain'],
          ['dashboard-receive-domain.html','Receive Domain'],
          ['reseller-dashboard.html','Overview'],
          ['ai-builder.html?dashboard=reseller','AI Builder'],
          ['profile-settings.html','Profile Settings'],
          ['dashboard-support.html','Support'],
          ['reseller-bank-api.html',"Banking API KEY's"],
          ['reseller-domain-api.html',"Domain Reseller API KEY's"]
        ],
        staff: [
          ['staff.html','Overview'],
          ['staff-users.html','User Support'],
          ['staff-conversations.html','Conversations'],
          ['dashboard-register-domain.html','Register Domain'],
          ['dashboard-dns-manager.html','DNS Manager'],
          ['dashboard-business-email.html','Business Email'],
          ['dashboard-transfer-domain.html','Transfer Domain'],
          ['dashboard-receive-domain.html','Receive Domain'],
          ['dashboard-wallet.html','Banking'],
          ['ai-builder.html?dashboard=staff','AI Builder'],
          ['dashboard-support.html','Support']
        ],
        admin: [
          ['admin.html','Overview'],
          ['admin-users.html','Users'],
          ['admin-orders.html','Orders'],
          ['admin-wallets.html','Wallets'],
          ['admin-bank.html','WNH Bank'],
          ['admin-domains.html','Domain Activity'],
          ['dashboard-register-domain.html','Register Domain'],
          ['dashboard-dns-manager.html','DNS Manager'],
          ['dashboard-business-email.html','Business Email'],
          ['dashboard-transfer-domain.html','Transfer Domain'],
          ['dashboard-receive-domain.html','Receive Domain'],
          ['dashboard-wallet.html','Banking'],
          ['ai-builder.html?dashboard=admin','AI Builder'],
          ['admin-support.html','Support']
        ]
      };
      const menuRole = currentUser.role === 'admin' ? 'admin' : currentUser.role === 'staff' ? 'staff' : 'reseller';
      const items = roleMenus[menuRole];
      if (items) {
        nav.innerHTML = items.map(([href,label]) => {
          const hrefPage = href.split('#')[0].split('?')[0].toLowerCase();
          const active = page === hrefPage || (page.startsWith('wallet-') && (label === 'Banking Transfers' || label === 'WNH Bank'));
          return `<a href="${href}" class="${active ? 'active' : ''}">${label}</a>`;
        }).join('');
        const small = sidebar.querySelector('.app-brand-copy small');
        const brand = sidebar.querySelector('.app-brand');
        if (menuRole === 'admin') {
          if (small) small.textContent = 'Admin Portal';
          if (brand) brand.href = 'admin.html';
        } else if (menuRole === 'staff') {
          if (small) small.textContent = 'Staff Workspace';
          if (brand) brand.href = 'staff.html';
        } else {
          if (small) small.textContent = 'Account Portal';
          if (brand) brand.href = 'reseller-dashboard.html';
        }
      }
    }


    const apiBase = String(window.WORLDNET_CONFIG?.API_BASE_URL || window.WORLDNET_API_BASE_URL || window.WORLDNET_API_BASE || '/api').replace(/\/$/, '');
    const userToken = localStorage.getItem('worldnet_token') || '';
    const adminToken = localStorage.getItem('worldnet_admin_token') || '';
    const activeToken = currentUser.role === 'admin' ? adminToken : userToken;
    const mountProfileShortcut = async () => {
      if (!activeToken || ['admin','staff'].includes(currentUser.role)) return;
      const actions=document.querySelector('.app-top-actions'); if(!actions)return;
      const chip=actions.querySelector('.profile-chip');
      if(chip){chip.removeAttribute('onclick');chip.style.cursor='pointer';chip.addEventListener('click',()=>{location.href='profile-settings.html';});}
      const avatar=document.createElement('button');avatar.type='button';avatar.className='profile-photo-shortcut';avatar.title='Profile Settings';avatar.innerHTML='<span>👤</span>';avatar.addEventListener('click',()=>{location.href='profile-settings.html';});actions.prepend(avatar);
      try{const r=await fetch(`${String(window.WORLDNET_CONFIG?.API_BASE_URL || window.WORLDNET_API_BASE_URL || window.WORLDNET_API_BASE || '/api').replace(/\/$/,'')}/auth/profile/photo`,{headers:{Authorization:`Bearer ${activeToken}`},cache:'no-store'});if(r.ok){const blob=await r.blob();const img=document.createElement('img');img.alt='Profile photo';img.src=URL.createObjectURL(blob);avatar.innerHTML='';avatar.appendChild(img);}}catch{}
    };
    const escapeAccountHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const copyBankValue = async (value, label) => {
      if (!value) return;
      try { await navigator.clipboard.writeText(String(value)); }
      catch {
        const area=document.createElement('textarea'); area.value=String(value); document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      }
      const note=document.querySelector('.wnh-bank-account-copy-status');
      if (note) { note.textContent=`${label} copied.`; setTimeout(()=>{ if(note.textContent.includes('copied')) note.textContent=''; },2200); }
    };
    const mountPersistentBankAccount = async () => {
      if (!userToken || currentUser.role === 'admin' || currentUser.role === 'staff') return;
      const appMain=document.querySelector('.app-main');
      if (!appMain || document.querySelector('.wnh-bank-account-strip')) return;
      const card=document.createElement('section');
      card.className='wnh-bank-account-strip';
      card.innerHTML='<div class="wnh-bank-account-loading">Loading your WNH Bank account details…</div>';
      const topbarNow=appMain.querySelector('.app-topbar');
      if (topbarNow?.nextSibling) appMain.insertBefore(card, topbarNow.nextSibling); else appMain.appendChild(card);
      try {
        const response=await fetch(`${apiBase}/wallet/banking/summary`,{cache:'no-store',headers:{Accept:'application/json',Authorization:`Bearer ${userToken}`}});
        const data=await response.json().catch(()=>({}));
        if (!response.ok) throw new Error(data.message||`Bank details unavailable (${response.status})`);
        const account=data.dedicatedAccount||{};
        if (account.active && account.accountNumber) {
          card.innerHTML=`<div class="wnh-bank-account-title"><div><span>WNH Bank • Receiving Account</span><strong>${escapeAccountHtml(account.bankName||'Bank Account')}</strong></div><a href="dashboard-wallet.html">Open WNH Bank</a></div><div class="wnh-bank-account-grid"><div><small>Account Number</small><strong>${escapeAccountHtml(account.accountNumber)}</strong><button type="button" data-bank-copy="number">Copy</button></div><div><small>Account Name</small><strong>${escapeAccountHtml(account.accountName||'World Net Hosting Customer')}</strong><button type="button" data-bank-copy="name">Copy</button></div><div><small>Bank</small><strong>${escapeAccountHtml(account.bankName||'Paystack Bank')}</strong><button type="button" data-bank-copy="bank">Copy</button></div><div><small>Currency</small><strong>${escapeAccountHtml(account.currency||'NGN')}</strong><span class="wnh-bank-status">Active</span></div></div><div class="wnh-bank-account-copy-status" aria-live="polite"></div>`;
          card.querySelector('[data-bank-copy="number"]')?.addEventListener('click',()=>copyBankValue(account.accountNumber,'Account number'));
          card.querySelector('[data-bank-copy="name"]')?.addEventListener('click',()=>copyBankValue(account.accountName||'World Net Hosting Customer','Account name'));
          card.querySelector('[data-bank-copy="bank"]')?.addEventListener('click',()=>copyBankValue(account.bankName||'Paystack Bank','Bank name'));
        } else {
          const pending=account.assignmentStatus==='pending';
          card.innerHTML=`<div class="wnh-bank-account-title"><div><span>WNH Bank • Receiving Account</span><strong>${pending?'Account setup pending':'No receiving account yet'}</strong></div><a href="wallet-receive.html">${pending?'Check Account Status':'Create Bank Account'}</a></div><p class="wnh-bank-account-help">${escapeAccountHtml(account.assignmentMessage||'Create your receiving account once, then your bank details will remain visible across your WNH dashboard.')}</p>`;
        }
      } catch (error) {
        card.innerHTML=`<div class="wnh-bank-account-title"><div><span>WNH Bank</span><strong>Account details temporarily unavailable</strong></div><a href="dashboard-wallet.html">Open WNH Bank</a></div><p class="wnh-bank-account-help">${escapeAccountHtml(error.message)}</p>`;
      }
    };
    mountPersistentBankAccount();
    mountProfileShortcut();

    const role = currentUser.role === 'admin' ? 'admin' : currentUser.role === 'staff' ? 'staff' : 'reseller';
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
        const isAdmin = Boolean(localStorage.getItem('worldnet_admin_token'));
        if (isAdmin && typeof window.logoutAdmin === 'function') {
          window.logoutAdmin();
          return;
        }
        if (typeof window.logoutUser === 'function') {
          window.logoutUser();
          return;
        }
        ['worldnet_token','worldnet_user','worldnet_pin_mode','worldnet_pin_ok','worldnet_return_to','worldnet_admin_token','worldnet_admin_user']
          .forEach(key => localStorage.removeItem(key));
        sessionStorage.removeItem('worldnet_return_to');
        window.location.replace('reseller-signin.html');
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
