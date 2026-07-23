"use strict";
(() => {
  const init = () => {
    const sidebar = document.querySelector('.app-sidebar');
    if (!sidebar) return;
    const viewport = sidebar.querySelector('.app-nav-viewport');
    const nav = sidebar.querySelector('.app-nav');
    if (!viewport || !nav) return;
    const updateButtons = () => {
      const up = sidebar.querySelector('[data-nav-scroll="up"]');
      const down = sidebar.querySelector('[data-nav-scroll="down"]');
      const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (up) up.disabled = viewport.scrollTop <= 2;
      if (down) down.disabled = viewport.scrollTop >= max - 2;
    };
    sidebar.querySelectorAll('[data-nav-scroll]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = button.dataset.navScroll === 'up' ? -1 : 1;
        viewport.scrollBy({ top: direction * Math.max(150, viewport.clientHeight * 0.58), behavior: 'smooth' });
      });
    });
    viewport.addEventListener('scroll', updateButtons, { passive: true });
    // Allow normal mouse-wheel and touchpad scrolling anywhere over the sidebar.
    sidebar.addEventListener('wheel', (event) => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      viewport.scrollTop += event.deltaY;
      event.preventDefault();
    }, { passive: false });
    viewport.addEventListener('touchstart', () => {}, { passive: true });
    window.addEventListener('resize', updateButtons, { passive: true });
    const active = nav.querySelector('a.active');
    if (active) requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest' }));
    requestAnimationFrame(updateButtons);
    document.querySelectorAll('iframe[data-dashboard-embed]').forEach((frame) => {
      frame.addEventListener('load', () => {
        try {
          const doc = frame.contentDocument;
          if (!doc) return;
          doc.documentElement.classList.add('dashboard-embedded');
          if (doc.body) doc.body.classList.add('dashboard-embedded-body');
          doc.querySelectorAll('header.top-nav, header.site-header, .search-strip, footer.site-footer, .contact-floating, .public-dashboard-actions').forEach((node) => node.remove());
        } catch (_) {}
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
