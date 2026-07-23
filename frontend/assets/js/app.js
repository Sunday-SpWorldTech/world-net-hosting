// Dashboard iframe mode: keep service content only, never render a second navigation shell.
(function(){
  try {
    const embedded = new URLSearchParams(location.search).get('dashboard_embed') === '1' && window.self !== window.top;
    if (!embedded) return;
    const apply = () => {
      document.documentElement.classList.add('dashboard-embedded');
      if (document.body) document.body.classList.add('dashboard-embedded-body');
      document.querySelectorAll('header.top-nav, header.site-header, .search-strip, footer.site-footer, .contact-floating').forEach((node) => node.remove());
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once:true }); else apply();
  } catch (_) {}
})();
const WORLDNET_CONFIG = window.WORLDNET_CONFIG || {};
const API_BASE = String(WORLDNET_CONFIG.API_BASE_URL || window.WORLDNET_API_BASE || 'https://world-net-hosting-backend.onrender.com/api').replace(/\/$/,'');
const PAYSTACK_PUBLIC_KEY = WORLDNET_CONFIG.PAYSTACK_PUBLIC_KEY || window.PAYSTACK_PUBLIC_KEY || '';
const $ = (s) => document.querySelector(s);
const cart = JSON.parse(localStorage.getItem('world_net_hosting_cart') || '[]');
let currencyConfig = { countryCurrency: {}, supportedPaystackCurrencies: ['NGN'], displayCurrencies: ['USD','NGN','GHS','KES','ZAR','GBP','EUR'], paystackDefaultCurrency: 'NGN' };
let preferredCurrency = localStorage.getItem('worldnet_currency') || 'USD';
let usdToLocalRate = Number(localStorage.getItem(`worldnet_rate_USD_${preferredCurrency}`) || 1);

function updateCartCount(){
  const count=cart.length;
  document.querySelectorAll('.cart').forEach(c=>c.dataset.count=count);
  document.querySelectorAll('.dashboard-cart-link').forEach(link=>{
    let badge=link.querySelector('.dashboard-cart-count');
    if(!badge){badge=document.createElement('span');badge.className='dashboard-cart-count';link.appendChild(badge);}
    badge.textContent=String(count);
    badge.setAttribute('aria-label',`${count} item${count===1?'':'s'} in cart`);
    link.classList.toggle('has-items',count>0);
    link.classList.toggle('is-empty',count===0);
    link.title=count?`${count} item${count===1?'':'s'} in cart`:'Cart is empty';
  });
}
function setStatus(message){ const out = $('#auth-status') || $('#form-status') || $('#admin-status') || $('#chat-status'); if(out){ out.style.display='block'; out.textContent = message; } }
function showToast(message,type='info',showCart=false){ let wrap=document.getElementById('wnh-toast-wrap'); if(!wrap){wrap=document.createElement('div');wrap.id='wnh-toast-wrap';document.body.appendChild(wrap);} const toast=document.createElement('div');toast.className=`wnh-toast ${type}`;toast.innerHTML=`<div><strong>${type==='success'?'Added successfully':type==='error'?'Something went wrong':'Notice'}</strong><span>${message}</span></div>${showCart?'<a href="'+(getToken()?'dashboard-cart.html':'cart.html')+'">View cart</a>':''}<button aria-label="Close">×</button>`;wrap.appendChild(toast);toast.querySelector('button').onclick=()=>toast.remove();setTimeout(()=>toast.remove(),5000);}
function markStaticPrices(){
  const selectors=['.price','.price-note strong','[data-price]','.plan-price'];
  document.querySelectorAll(selectors.join(',')).forEach(el=>{
    if(el.dataset.usdPrice) return;
    const text=(el.textContent||'').trim();
    const match=text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if(!match) return;
    el.dataset.usdPrice=match[1];
    el.dataset.priceSuffix=text.replace(match[0],'').trim();
  });
}
function refreshCurrencyUI(){
  markStaticPrices();
  document.querySelectorAll('[data-usd-price]').forEach(el=>{
    const amount=Number(el.dataset.usdPrice||0);
    const suffix=el.dataset.priceSuffix ? ` <span class="small">${el.dataset.priceSuffix}</span>` : '';
    el.innerHTML=dualMoney(amount)+suffix;
  });
  document.querySelectorAll('[data-currency-select]').forEach(sel=>sel.value=preferredCurrency);
  renderCart();
}

function ensureDashboardCartButton(){
  if(!document.body.classList.contains('dashboard-body')) return;
  const page=(location.pathname.split('/').pop()||'').toLowerCase();
  if(page==='admin-dashboard.html' || page==='staff.htm' || page==='staff.htm') return;
  const actions=document.querySelector('.app-top-actions');
  if(!actions) return;
  let link=actions.querySelector('.dashboard-cart-link');
  if(!link) link=actions.querySelector('a[href="dashboard-cart.html"]');
  if(!link){
    link=document.createElement('a');
    link.href='dashboard-cart.html';
    const account=actions.querySelector('.profile-chip,.icon-button');
    if(account) actions.insertBefore(link,account); else actions.appendChild(link);
  }
  link.className='dashboard-cart-link is-empty';
  link.setAttribute('aria-label','Open dashboard cart');
  link.innerHTML='<span aria-hidden="true">🛒</span><span class="dashboard-cart-count">0</span>';
}

function setupDashboardMobileMenu(){
  if(!document.body.classList.contains('dashboard-body')) return;
  const sidebar=document.querySelector('.app-sidebar');
  const topbar=document.querySelector('.app-topbar');
  if(!sidebar||!topbar||document.querySelector('.app-mobile-menu-button')) return;
  const button=document.createElement('button');
  button.type='button';
  button.className='app-mobile-menu-button';
  button.setAttribute('aria-label','Open dashboard menu');
  button.setAttribute('aria-expanded','false');
  button.innerHTML='<span aria-hidden="true">☰</span><span>Menu</span>';
  topbar.prepend(button);
  const backdrop=document.createElement('button');
  backdrop.type='button';
  backdrop.className='app-sidebar-backdrop';
  backdrop.setAttribute('aria-label','Close dashboard menu');
  document.body.appendChild(backdrop);
  const setOpen=(open)=>{
    document.body.classList.toggle('dashboard-menu-open',open);
    button.setAttribute('aria-expanded',String(open));
    button.setAttribute('aria-label',open?'Close dashboard menu':'Open dashboard menu');
    button.querySelector('[aria-hidden]')?.replaceChildren(document.createTextNode(open?'×':'☰'));
  };
  button.addEventListener('click',()=>setOpen(!document.body.classList.contains('dashboard-menu-open')));
  backdrop.addEventListener('click',()=>setOpen(false));
  sidebar.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>setOpen(false)));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false)});
  window.addEventListener('resize',()=>{if(window.innerWidth>820)setOpen(false)},{passive:true});
}

function setupDashboardSidebar(){
  const sidebar=document.querySelector('.app-sidebar');
  if(!sidebar) return;
  const active=sidebar.querySelector('.app-nav a.active');
  if(active) requestAnimationFrame(()=>active.scrollIntoView({block:'nearest'}));
}

function injectCurrencySelector(){}
function saveSession(data){ localStorage.setItem('worldnet_token', data.token); localStorage.setItem('worldnet_user', JSON.stringify(data.user)); localStorage.setItem('worldnet_pin_mode', data.next || (data.user?.hasPin ? 'verify-pin' : 'create-pin')); }
function saveAdminSession(data){ localStorage.setItem('worldnet_admin_token', data.token); localStorage.setItem('worldnet_admin_user', JSON.stringify(data.user)); }
function getToken(){ return localStorage.getItem('worldnet_token'); }
function getAdminToken(){ return localStorage.getItem('worldnet_admin_token'); }
function logoutUser(){ ['worldnet_token','worldnet_user','worldnet_pin_mode','worldnet_pin_ok','worldnet_return_to'].forEach(k=>localStorage.removeItem(k)); sessionStorage.removeItem('worldnet_return_to'); location.replace('signin.html'); }
function logoutAdmin(){ ['worldnet_admin_token','worldnet_admin_user'].forEach(k=>localStorage.removeItem(k)); location.replace('signin.html'); }
function requireToken(){ if(!getToken()){ sessionStorage.setItem('worldnet_return_to', location.pathname.split('/').pop() || 'dashboard.html'); location.replace('signin.html'); return false; } return true; }
function requireAdminToken(){ if(!getAdminToken()){ location.replace('admin-login.html'); return false; } return true; }
function money(value, currency='USD'){
  const num = Number(value || 0);
  try { return new Intl.NumberFormat(undefined, { style:'currency', currency: currency || 'USD' }).format(num); }
  catch { return `${currency || 'USD'} ${num.toFixed(2)}`; }
}
function detectCountry(){
  const lang = (navigator.language || 'en-US').toUpperCase();
  const parts = lang.split('-');
  if(parts[1]) return parts[1];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if(tz.includes('Lagos')) return 'NG';
  if(tz.includes('Accra')) return 'GH';
  if(tz.includes('Nairobi')) return 'KE';
  if(tz.includes('Johannesburg')) return 'ZA';
  if(tz.includes('London')) return 'GB';
  return 'US';
}
function localMoney(usdValue){ return money(Number(usdValue || 0) * usdToLocalRate, preferredCurrency); }
function dualMoney(usdValue){ return preferredCurrency === 'USD' ? money(usdValue, 'USD') : `${localMoney(usdValue)} <span class="small">(${money(usdValue, 'USD')})</span>`; }
async function changeCurrency(code){
  preferredCurrency=String(code||'USD').toUpperCase();
  localStorage.setItem('worldnet_currency', preferredCurrency);
  usdToLocalRate=1;
  if(preferredCurrency!=='USD'){
    const cached=Number(localStorage.getItem(`worldnet_rate_USD_${preferredCurrency}`)||0);
    if(cached>0) usdToLocalRate=cached;
    try{
      const r=await fetch(`${API_BASE}/currency/convert?amount=1&from=USD&to=${encodeURIComponent(preferredCurrency)}`,{cache:'no-store'});
      const d=await r.json();
      if(r.ok && Number(d.rate||d.convertedAmount)>0){
        usdToLocalRate=Number(d.rate||d.convertedAmount);
        localStorage.setItem(`worldnet_rate_USD_${preferredCurrency}`,String(usdToLocalRate));
      }
    }catch(e){ console.warn('Currency rate unavailable; using cached rate',e); }
  }
  refreshCurrencyUI();
  document.dispatchEvent(new CustomEvent('wnh:currency-changed',{detail:{currency:preferredCurrency,rate:usdToLocalRate}}));
  window.dispatchEvent(new CustomEvent('worldnet:currency-changed',{detail:{currency:preferredCurrency,rate:usdToLocalRate}}));
  const active=document.querySelector('.domain-input:focus')||document.querySelector('.domain-input');
  if(active?.value) searchDomains(active.value);
  return {currency:preferredCurrency,rate:usdToLocalRate};
}
window.changeCurrency=changeCurrency;
window.addEventListener('storage',event=>{ if(event.key==='worldnet_currency' && event.newValue && event.newValue!==preferredCurrency) changeCurrency(event.newValue); });
async function initCurrency(){
  try{
    const res = await fetch(`${API_BASE}/currency/config`);
    currencyConfig = await res.json();
    const country = detectCountry();
    preferredCurrency = localStorage.getItem('worldnet_currency') || currencyConfig.countryCurrency?.[country] || 'USD';
    localStorage.setItem('worldnet_currency', preferredCurrency);
    if(preferredCurrency !== 'USD'){
      const rateRes = await fetch(`${API_BASE}/currency/convert?amount=1&from=USD&to=${preferredCurrency}`);
      const rateData = await rateRes.json();
      usdToLocalRate = Number(rateData.rate || 1);
      localStorage.setItem(`worldnet_rate_USD_${preferredCurrency}`, usdToLocalRate);
    }
  }catch(e){ preferredCurrency = localStorage.getItem('worldnet_currency') || 'USD'; }
}
function paystackCurrency(){ return 'NGN'; }

function addToCart(item){
  const usdPrice = Number(item.usdPrice ?? item.price ?? 0);
  cart.push({ ...item, usdPrice, price: usdPrice, currency: 'USD', displayCurrency: preferredCurrency, localEstimate: Number((usdPrice * usdToLocalRate).toFixed(2)) });
  localStorage.setItem('world_net_hosting_cart', JSON.stringify(cart));
  updateCartCount();
  showToast(`${item.name} added to cart`, 'success', true);
}

const DOMAIN_RESULTS_COLLAPSED_COUNT=12;
const DOMAIN_RESULTS_STEP=24;
let domainResultState={box:null,results:[],visible:DOMAIN_RESULTS_COLLAPSED_COUNT};

function renderDomainResults(){
  const {box,results}=domainResultState;
  if(!box) return;
  if(!results.length){
    box.innerHTML='<div class="notice">No live domain result returned. Check reseller endpoint path and response mapping.</div>';
    return;
  }
  const visible=Math.min(domainResultState.visible,results.length);
  const rows=results.slice(0,visible).map(d=>{
    const firstYearPrice=Number(d.firstYearPrice ?? d.price ?? 0);
    const renewalPrice=Number(d.renewalPrice ?? firstYearPrice);
    const verified=d.available===true||d.available===false;
    const statusLabel=d.available===true ? 'Available' : (d.premium ? 'Premium' : d.available===false ? 'Taken' : 'Checking unavailable');
    const priceBlock=d.available===true && Number.isFinite(firstYearPrice) && firstYearPrice>0
      ? `<div><strong>${dualMoney(firstYearPrice)}/1st yr</strong><br><span class="small">Renews at ${dualMoney(renewalPrice)}/yr</span> <button class="btn teal" onclick='addToCart({type:"domain",domain:"${d.domain}",name:"${d.domain}",period:1,usdPrice:${firstYearPrice},price:${firstYearPrice},renewalPrice:${renewalPrice},currency:"USD"})'>Add</button></div>`
      : d.available===false ? '<div><strong>Not available</strong><br><span class="small">Try another extension</span></div>' : '<div><strong>Registry result unavailable</strong><br><span class="small">Search again shortly</span></div>';
    return `<div class="domain-row"><div><strong>${escapeHtml(d.domain)}</strong> <span class="badge">${statusLabel}</span><br><span class="small">${escapeHtml(d.message || (d.available ? 'Available to register' : 'Already registered'))}</span></div>${priceBlock}</div>`;
  }).join('');
  const hasMore=visible<results.length;
  const canCollapse=visible>DOMAIN_RESULTS_COLLAPSED_COUNT;
  box.innerHTML=`<div class="domain-results-summary"><strong>Domain search results</strong><span>Showing ${visible} of ${results.length} extensions</span></div><div class="domain-result-list">${rows}</div><div class="domain-result-controls">${hasMore?'<button type="button" class="btn teal" data-domain-show-more>Show More</button>':''}${canCollapse?'<button type="button" class="btn domain-show-less" data-domain-show-less>Show Less</button>':''}</div>`;
  box.querySelector('[data-domain-show-more]')?.addEventListener('click',()=>{
    domainResultState.visible=Math.min(results.length,visible+DOMAIN_RESULTS_STEP);
    renderDomainResults();
  });
  box.querySelector('[data-domain-show-less]')?.addEventListener('click',()=>{
    domainResultState.visible=Math.min(DOMAIN_RESULTS_COLLAPSED_COUNT,results.length);
    renderDomainResults();
    box.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

async function searchDomains(query, trigger){
  let input = null;
  if (trigger instanceof Element) {
    const container = trigger.closest('.search-box, .hero-search, form');
    input = container?.querySelector('.domain-input') || null;
  }
  if (!input) input = document.querySelector('.domain-input');
  let q = String(query || input?.value || '').trim().toLowerCase();
  if(q && !q.includes('.')) q += '.com';
  if(!q){ showToast('Enter a domain name, for example example.com', 'warning'); return; }
  const box = $('#domain-results');
  if(!box) return;
  box.setAttribute('aria-live','polite');
  box.style.display='block'; box.innerHTML='<div class="domain-search-loading domain-search-loading-compact" role="status" aria-label="Checking domain availability"><span class="domain-loading-spinner" aria-hidden="true"></span></div>';
  try{
    const res = await fetch(`${API_BASE}/domains/search?name=${encodeURIComponent(q)}`);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { throw new Error(text || `Domain API returned HTTP ${res.status}`); }
    if(!res.ok) throw new Error(data.message || 'Live domain search failed');
    const results=(data.results||[]);
    domainResultState={box,results,visible:Math.min(DOMAIN_RESULTS_COLLAPSED_COUNT,results.length)};
    renderDomainResults();
  }catch(e){box.innerHTML=`<strong>Domain API check failed.</strong><p class="small">${escapeHtml(e.message || 'Start backend or verify Render API URL.')}</p>`}
}

async function submitContact(e){
  e.preventDefault();
  const form = e.target; const payload = Object.fromEntries(new FormData(form));
  const out = $('#form-status'); if(out) out.textContent = 'Sending...';
  try{ const res = await fetch(`${API_BASE}/contact`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await res.json(); if(out) out.textContent = data.message || 'Message submitted'; form.reset(); }
  catch(err){ if(out) out.textContent = 'Backend is not running. Start/deploy the API to save messages.'; }
}

async function loadPlans(){
  const el = $('#plans'); if(!el) return;
  try{ const res = await fetch(`${API_BASE}/plans`); const plans = await res.json(); el.innerHTML = plans.map(p=>`<div class="card"><h3>${p.name}</h3><p>${p.description}</p><div class="price">${dualMoney(p.price)}<span class="small">/${p.billing}</span></div><button class="btn teal" onclick='addToCart({type:"plan",name:"${p.name}",usdPrice:${p.price},price:${p.price},currency:"USD"})'>Choose Plan</button><div class="feature-list">${(p.features || []).map(f=>`<span>${f}</span>`).join('')}</div></div>`).join(''); }catch(e){}
}

function renderCart(){
 const el=$('#cart-items'); if(!el) return; updateCartCount();
 if(!cart.length){el.innerHTML='<div class="notice">Your cart is empty.</div>';return;}
 let total=cart.reduce((a,b)=>a+Number(b.usdPrice ?? b.price ?? 0),0);
 const paymentCurrency = paystackCurrency();
 el.innerHTML=cart.map((i,idx)=>`<div class="domain-row"><div><strong>${i.name}</strong><br><span class="small">${i.type}</span></div><div><strong>${dualMoney(i.usdPrice ?? i.price)}</strong> <button class="btn" onclick="cart.splice(${idx},1);localStorage.setItem('world_net_hosting_cart',JSON.stringify(cart));renderCart()">Remove</button></div></div>`).join('')+`<div class="notice">Total: <strong>${dualMoney(total)}</strong><br><span class="small">Paystack will charge in ${paymentCurrency}. If your country currency is not enabled by your Paystack account, backend will use your default Paystack currency.</span></div><div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn" onclick="createOrder()">Save Order</button><button class="btn teal" onclick="payWithPaystack()">Pay Now with Paystack</button><button class="btn teal" onclick="payWithWallet()">Pay with Banking Balance</button><span id="checkout-wallet-balance" class="small">Loading wallet balance…</span></div>`;
}

async function loadCheckoutWalletBalance(){const el=document.getElementById('checkout-wallet-balance');if(!el||!getToken())return;try{const d=await apiJson(`${API_BASE}/wallet/banking/summary`,{headers:{Authorization:`Bearer ${getToken()}`}});el.textContent=`Banking balance: ${money(d.balance||0,d.currency||'NGN')}`;}catch(e){el.textContent='Banking balance unavailable';}}
async function payWithWallet(){if(!getToken())return location.href='signin.html';if(!cart.length)return showToast('Your cart is empty.','warning');try{const d=await apiJson(`${API_BASE}/orders/wallet-checkout`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({items:cart})});showToast(d.message||'Payment completed from wallet.','success');localStorage.removeItem('world_net_hosting_cart');cart.splice(0,cart.length);renderCart();loadCheckoutWalletBalance();}catch(e){showToast(e.message||'Wallet payment failed.','error')}}

async function createOrder(){
 if(!getToken()){ sessionStorage.setItem('worldnet_return_to','dashboard-cart.html'); showToast('Please sign in to complete your order.','warning'); setTimeout(()=>location.href='signin.html',700); return; }
 try{ const res=await fetch(`${API_BASE}/orders`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({items:cart})}); const data=await res.json(); if(!res.ok) throw new Error(data.message || 'Order failed'); showToast(`${data.message}. Total ${money(data.total, data.currency || 'USD')}`,'success'); localStorage.removeItem('world_net_hosting_cart'); cart.splice(0,cart.length); setTimeout(()=>renderCart(),500); }
 catch(e){showToast(e.message || 'Could not save the order. Please try again.','error')}
}

async function payWithPaystack(){
 if(!getToken()){ sessionStorage.setItem('worldnet_return_to','dashboard-cart.html'); showToast('Please sign in or create an account before payment.','warning'); setTimeout(()=>location.href='signin.html',700); return; }
 const email=$('#checkout-email')?.value||JSON.parse(localStorage.getItem('worldnet_user')||'{}').email;
 if(!email){ showToast('Your account email is required before payment.','warning'); return; }
 try{
   const res=await fetch(`${API_BASE}/payments/paystack/checkout`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({items:cart,paymentCurrency:paystackCurrency(),displayCurrency:preferredCurrency})});
   const raw=await res.text();
   let data; try{ data=raw ? JSON.parse(raw) : {}; }catch{ data={message:raw || `Paystack returned HTTP ${res.status}`}; }
   if(!res.ok) throw new Error(data.message || 'Payment initialization failed');
   if(data?.data?.authorization_url){ localStorage.setItem('worldnet_pending_payment','yes'); location.assign(data.data.authorization_url); return; }
   showToast('Payment could not open. Please try again or contact support.','error');
 }catch(e){ showToast(e.message || 'Payment could not be started. Please try again.','error'); }
}


function setupGitHubAuthLinks(){document.querySelectorAll('[data-github-role]').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();const role=link.dataset.githubRole||'user';const returnTo=role==='staff'?'staff.htm':'dashboard.html';location.href=`${API_BASE}/auth/github/start?role=${encodeURIComponent(role)}&returnTo=${encodeURIComponent(returnTo)}`;}));}

async function handleSignup(e){ e.preventDefault(); setStatus('Creating account...'); const payload = Object.fromEntries(new FormData(e.target)); try{ const res = await fetch(`${API_BASE}/auth/signup`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); const data = await res.json(); if(!res.ok) throw new Error(data.message || 'Signup failed'); saveSession(data); location.href='pin.html'; }catch(err){ setStatus(err.message); } }
async function handleLogin(e){ e.preventDefault(); setStatus('Signing in...'); const payload = Object.fromEntries(new FormData(e.target)); try{ const res = await fetch(`${API_BASE}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); const data = await res.json(); if(!res.ok) throw new Error(data.message || 'Login failed'); saveSession(data); location.href='pin.html'; }catch(err){ setStatus(err.message); } }
async function handleAdminLogin(e){ e.preventDefault(); setStatus('Signing in securely...'); const payload = Object.fromEntries(new FormData(e.target)); try{ const res = await fetch(`${API_BASE}/auth/admin/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); const data = await res.json(); if(!res.ok) throw new Error(data.message || 'Admin sign-in failed'); saveAdminSession(data); location.replace('admin-dashboard.html'); }catch(err){ setStatus(err.message); } }

async function handlePin(e){
  e.preventDefault(); if(!requireToken()) return;
  const mode = localStorage.getItem('worldnet_pin_mode') || 'verify-pin';
  const endpoint = mode === 'create-pin' ? '/auth/pin/create' : '/auth/pin/verify';
  setStatus(mode === 'create-pin' ? 'Creating PIN...' : 'Checking PIN...');
  try{ const res = await fetch(`${API_BASE}${endpoint}`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${getToken()}`}, body:JSON.stringify(Object.fromEntries(new FormData(e.target))) }); const data = await res.json(); if(!res.ok) throw new Error(data.message || 'PIN failed'); localStorage.setItem('worldnet_user', JSON.stringify(data.user)); localStorage.setItem('worldnet_pin_ok','yes'); const target=sessionStorage.getItem('worldnet_return_to')||'dashboard.html'; sessionStorage.removeItem('worldnet_return_to'); location.replace(target); }catch(err){ setStatus(err.message); }
}

function setupPinPage(){
  const form = $('#pin-form'); if(!form) return; if(!requireToken()) return;
  const mode = localStorage.getItem('worldnet_pin_mode') || 'verify-pin';
  $('#pin-title').textContent = mode === 'create-pin' ? 'Create Dashboard PIN' : 'Enter Dashboard PIN';
  $('#pin-help').textContent = mode === 'create-pin' ? 'Create a secure 4–6 digit PIN. You will use it for future dashboard access.' : 'Enter your PIN to unlock your dashboard.';
  $('#pin-button').textContent = mode === 'create-pin' ? 'Create PIN' : 'Unlock Dashboard';
  form.addEventListener('submit', handlePin);
}

async function loadDashboard(){
 const el=$('#dashboard-data'); if(!el) return; if(!requireToken()) return; if(localStorage.getItem('worldnet_pin_ok')!=='yes'){ location.href='pin.html'; return; }
 try{ const res=await fetch(`${API_BASE}/user/dashboard`,{headers:{Authorization:`Bearer ${getToken()}`}}); const data=await res.json(); if(!res.ok) throw new Error(data.message || 'Dashboard failed'); el.className=''; el.innerHTML=`<div class="cards dashboard-stats-grid"><div class="card dashboard-stat-card"><h3>Welcome</h3><p>${data.user.name}</p><span class="badge">${data.user.email}</span></div><div class="card dashboard-stat-card"><h3>Banking Balance</h3><div class="price">${money(data.wallet?.balance || 0, data.wallet?.currency || 'NGN')}</div></div><div class="card dashboard-stat-card"><h3>Orders</h3><div class="price">${data.summary.orders}</div></div><div class="card dashboard-stat-card"><h3>Registered Domains</h3><div class="price">${(data.domains||[]).length}</div></div></div><h2 style="margin-top:24px">My Domains & DNS</h2>${(data.domains||[]).length ? data.domains.map(d=>`<div class="domain-row"><div><strong>${d.domain}</strong><br><span class="small">${d.status} • ${(d.nameservers||[]).join(', ')}</span></div><div><button class="btn teal" onclick="openDnsManager('${d.domain}')">Manage DNS</button></div></div><div id="dns-${d.domain.replace(/[^a-z0-9]/gi,'-')}"></div>`).join('') : '<div class="notice">No registered domain yet. Complete payment for a domain to add it here.</div>'}<h2 style="margin-top:24px">Recent Orders</h2>${data.orders.length ? data.orders.map(o=>`<div class="domain-row"><div><strong>Order ${o._id}</strong><br><span class="small">${new Date(o.createdAt).toLocaleString()} • Domain: ${o.domainProvisionStatus||'not_started'}</span></div><div><strong>${money(o.total,o.currency || 'USD')}</strong> <span class="badge">${o.status}</span></div></div>`).join('') : '<div class="notice">No order yet.</div>'}`; }catch(e){ el.textContent=e.message; }
}

async function loadAdmin(){
 const el=$('#admin-data'); if(!el) return; if(!requireAdminToken()) return;
 try{
   const headers={Authorization:`Bearer ${getAdminToken()}`};
   const [statsRes, messagesRes, ordersRes, searchesRes, walletsRes] = await Promise.all([fetch(`${API_BASE}/admin/stats`,{headers}),fetch(`${API_BASE}/admin/messages`,{headers}),fetch(`${API_BASE}/admin/orders`,{headers}),fetch(`${API_BASE}/admin/domain-searches`,{headers}),fetch(`${API_BASE}/admin/wallets`,{headers})]);
   const stats=await statsRes.json(); if(!statsRes.ok) throw new Error(stats.message || 'Admin stats failed');
   const messages=await messagesRes.json(); const orders=await ordersRes.json(); const searches=await searchesRes.json(); const wallets=await walletsRes.json();
   el.innerHTML=`<div class="cards admin-cards"><div class="card dashboard-stat-card"><h3>Orders</h3><div class="price">${stats.orders}</div></div><div class="card"><h3>Support Chats</h3><div class="price">${stats.openChats}</div></div><div class="card"><h3>Users</h3><div class="price">${stats.users || 0}</div></div><div class="card"><h3>Paid Revenue</h3><div class="price">${money(stats.revenue,'USD')}</div></div><div class="card"><h3>Pending Payment</h3><div class="price">${money(stats.pendingRevenue || 0,'USD')}</div></div><div class="card"><h3>Total Banking Balance</h3><div class="price">${stats.walletBalance || '0.00'}</div></div></div>
   <div class="notice">Domain API: ${stats.domainApiConfigured ? 'Configured on backend environment' : 'Not fully configured. Add Domain API env values on Render.'} | Paystack: ${stats.paystackConfigured ? 'Configured' : 'Not configured'} | Paystack currencies: ${(stats.supportedPaystackCurrencies||[]).join(', ')}</div>
   <section class="admin-section" id="admin-support"><h2>Support Chat / Contact Messages</h2><div class="admin-list">${messages.length ? messages.map(m=>`<div class="admin-item"><div><strong>${m.subject || m.service || 'Support message'}</strong> <span class="badge">${m.status}</span> <span class="badge">${m.source}</span><p>${m.message}</p><span class="small">${m.name} • ${m.email} • ${new Date(m.createdAt).toLocaleString()}</span>${(m.replies||[]).length?`<div class="notice">Replies: ${(m.replies||[]).map(r=>r.body).join(' | ')}</div>`:''}</div><div class="admin-actions"><button class="btn teal" onclick="markMessage('${m._id}','open')">Open</button><button class="btn" onclick="markMessage('${m._id}','closed')">Close</button><button class="btn" onclick="replyMessage('${m._id}')">Save Reply</button></div></div>`).join('') : '<div class="notice">No support message yet.</div>'}</div></section>
   <section class="admin-section" id="admin-transfers"><h2>Admin Banking Transfers</h2><div class="notice">Admin system-wallet withdrawals are processed directly through Paystack. No approval queue is used.</div><a class="btn teal" href="wallet-withdraw.html">Open Direct Bank Withdrawal</a></section><section class="admin-section" id="admin-orders"><h2>Orders / Payments</h2><div class="admin-list">${orders.length ? orders.map(o=>`<div class="admin-item"><div><strong>Order ${o._id}</strong><p>${(o.items||[]).map(i=>i.name).join(', ')}</p><span class="small">${o.customerEmail} • Ref: ${o.paymentReference || 'No payment reference'} • ${new Date(o.createdAt).toLocaleString()} • Domain: ${o.domainProvisionStatus || 'not_started'}</span></div><div><strong>${money(o.total||0,o.currency||'USD')}</strong> <span class="badge">${o.status}</span></div></div>`).join('') : '<div class="notice">No orders yet.</div>'}</div></section><section class="admin-section" id="admin-wallets"><h2>User Banking Balances</h2><div class="admin-list">${wallets.length ? wallets.map(w=>`<div class="admin-item"><div><strong>${w.email}</strong><p>${(w.transactions||[]).length} transaction(s)</p><span class="small">Updated ${new Date(w.updatedAt).toLocaleString()}</span></div><div><strong>${money(w.balance,w.currency)}</strong></div></div>`).join('') : '<div class="notice">No wallet yet.</div>'}</div></section>
   <section class="admin-section" id="admin-domains"><h2>Recent Domain Searches</h2><div class="admin-list">${searches.length ? searches.map(s=>`<div class="admin-item"><div><strong>${s.query}</strong> <span class="badge">${s.source}</span><p>${s.apiMessage||''}</p><span class="small">${new Date(s.createdAt).toLocaleString()}</span></div><div>${(s.results||[]).slice(0,3).map(r=>`<span class="badge">${r.domain}</span>`).join(' ')}</div></div>`).join('') : '<div class="notice">No domain searches yet.</div>'}</div></section>`;
 }catch(e){el.innerHTML=`<div class="notice">${e.message}. Use admin-login.html and make sure backend/API is deployed.</div>`}
}

async function markMessage(id,status){ try{ await fetch(`${API_BASE}/admin/messages/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getAdminToken()}`},body:JSON.stringify({status})}); location.reload(); } catch(e){ alert('Could not update message status'); } }
async function replyMessage(id){ const body = prompt('Write admin reply note. This saves inside admin dashboard. Connect email provider later to send externally.'); if(!body) return; try{ await fetch(`${API_BASE}/admin/messages/${id}/reply`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getAdminToken()}`},body:JSON.stringify({body})}); location.reload(); } catch(e){ alert('Could not save reply'); } }



function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setupSupportChat(){
  const embedded=new URLSearchParams(location.search).get('dashboard_embed')==='1' && window.self!==window.top;
  if(embedded) return;
  const page=(location.pathname.split('/').pop()||'').toLowerCase();
  const noChatPages=['admin-dashboard.html','staff.htm','wallet-deposit.html','wallet-withdraw.html','wallet-send.html','wallet-transfer.html','wallet-receive.html','wallet-convert.html'];
  if(noChatPages.includes(page)) return;
  if($('#support-widget') || $('#support-chat-launcher')) return;
  const user=JSON.parse(localStorage.getItem('worldnet_user')||'{}');
  const language=localStorage.getItem('worldnet_language')||document.documentElement.lang||'en';
  const div=document.createElement('div'); div.id='support-widget';
  div.innerHTML=`<button id="support-chat-launcher" type="button" aria-label="Open live chat">💬</button><div class="chat-panel" aria-live="polite"><div class="chat-head"><strong>WNH Live Chat</strong><div><button type="button" class="chat-scroll-up" title="Scroll up">▲</button><button type="button" class="chat-scroll-down" title="Scroll down">▼</button><button type="button" class="chat-close" title="Close">×</button></div></div><div id="chat-thread" class="chat-thread"><p class="small">Messages reach staff and admin. Your message is also translated to English.</p></div><div class="chat-status-actions"><button type="button" data-chat-status="open">Open</button><button type="button" data-chat-status="closed">Close</button></div><form id="support-chat-form" class="chat-form" enctype="multipart/form-data"><input name="name" placeholder="Name" value="${user.name||''}"><input name="email" type="email" placeholder="Email" value="${user.email||''}"><input name="subject" value="Support chat" placeholder="Subject"><textarea name="message" rows="3" placeholder="Type or paste text here"></textarea><input name="file" type="file" accept="image/*,.pdf,.doc,.docx,.txt"><input name="language" type="hidden" value="${language}"><button class="btn teal" type="submit">Send</button><div id="chat-status" class="small"></div></form></div>`;
  document.body.appendChild(div);
  const panel=div.querySelector('.chat-panel'),thread=div.querySelector('#chat-thread');
  const chatAccessToken=()=>localStorage.getItem('worldnet_chat_access_token')||'';
  const chatHeaders=(json=false)=>{const headers={};if(json)headers['Content-Type']='application/json';if(getToken())headers.Authorization=`Bearer ${getToken()}`;if(chatAccessToken())headers['X-Chat-Access-Token']=chatAccessToken();return headers;};
  const toggle=()=>{div.classList.toggle('open');if(div.classList.contains('open'))refreshChat();};
  div.querySelector('#support-chat-launcher').addEventListener('click',toggle); div.querySelector('.chat-close').addEventListener('click',()=>div.classList.remove('open'));
  div.querySelector('.chat-scroll-up').addEventListener('click',()=>thread.scrollBy({top:-140,behavior:'smooth'})); div.querySelector('.chat-scroll-down').addEventListener('click',()=>thread.scrollBy({top:140,behavior:'smooth'}));
  div.querySelectorAll('[data-chat-status]').forEach(btn=>btn.addEventListener('click',async()=>{const id=localStorage.getItem('worldnet_chat_ticket');if(!id)return;try{await apiJson(`${API_BASE}/support/chat/${id}/status`,{method:'PATCH',headers:chatHeaders(true),body:JSON.stringify({status:btn.dataset.chatStatus})});await refreshChat();}catch(e){$('#chat-status').textContent=e.message;}}));
  let timer; async function refreshChat(){const id=localStorage.getItem('worldnet_chat_ticket');if(!id)return;try{const item=await apiJson(`${API_BASE}/support/chat/${id}`,{headers:chatHeaders()});const tokenQuery=chatAccessToken()?`?accessToken=${encodeURIComponent(chatAccessToken())}`:'';thread.innerHTML=`<div class="chat-bubble user"><b>You</b><p>${escapeHtml(item.localMessage||item.message||'')}</p>${(item.attachments||[]).map(x=>`<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="${API_BASE.replace(/\/api$/,'')}${x.url}${tokenQuery}">📎 ${escapeHtml(x.filename)}</a>`).join('')}</div>${(item.replies||[]).map(r=>`<div class="chat-bubble staff"><b>${escapeHtml(r.repliedBy||'Support')}</b><p>${escapeHtml(r.localBody||r.body)}</p>${r.localBody&&r.localBody!==r.body?`<small>English: ${escapeHtml(r.body)}</small>`:''}</div>`).join('')}<small>Status: ${item.status}</small>`;thread.scrollTop=thread.scrollHeight;}catch(error){if(error.message.includes('Secure conversation access')){$('#chat-status').textContent='Start a new secure chat to continue.';clearInterval(timer);}}}
  div.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const out=$('#chat-status'),fd=new FormData(e.target);out.textContent='Sending…';try{const headers={};if(getToken())headers.Authorization=`Bearer ${getToken()}`;const res=await fetch(`${API_BASE}/support/chat`,{method:'POST',headers,body:fd});const data=await res.json();if(!res.ok)throw new Error(data.message||'Chat failed');localStorage.setItem('worldnet_chat_ticket',data.ticketId);localStorage.setItem('worldnet_chat_access_token',data.accessToken||'');out.textContent='Delivered to staff and admin.';e.target.querySelector('textarea').value='';e.target.querySelector('input[type=file]').value='';await refreshChat();clearInterval(timer);timer=setInterval(()=>{if(div.classList.contains('open'))refreshChat()},12000);}catch(err){out.textContent=err.message;}});
  document.querySelectorAll('.contact-floating').forEach(old=>old.remove());
  if(localStorage.getItem('worldnet_chat_ticket'))timer=setInterval(()=>{if(div.classList.contains('open'))refreshChat()},12000);
}

async function apiJson(url, options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),45000);
  let res;
  try{
    res=await fetch(url,{cache:'no-store',...options,signal:options.signal||controller.signal});
  }catch(error){
    if(error?.name==='AbortError') throw new Error('The backend request timed out. Confirm the Render backend is Live and try again.');
    throw new Error('Unable to reach the World Net Hosting backend. Confirm the backend deployment is Live and the frontend API URL is correct.');
  }finally{clearTimeout(timeout);}
  const text=await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(text || `HTTP ${res.status}`); }
  if(!res.ok) throw new Error(data.message || `HTTP ${res.status}`); return data;
}
async function openDnsManager(domain){
  const id=`dns-${domain.replace(/[^a-z0-9]/gi,'-')}`; const el=document.getElementById(id); if(!el) return;
  el.innerHTML='<div class="notice">Loading DNS records...</div>';
  try{ const data=await apiJson(`${API_BASE}/domains/${encodeURIComponent(domain)}/dns`,{headers:{Authorization:`Bearer ${getToken()}`}}); const records=data.records||data.data||data.results||[]; el.innerHTML=`<div class="notice"><strong>DNS Manager — ${domain}</strong><form class="form" onsubmit="addDnsRecord(event,'${domain}')"><select name="type"><option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option><option>TXT</option></select><input name="name" placeholder="Host/name, e.g. @ or www" required><input name="value" placeholder="Record value" required><input name="ttl" type="number" value="3600" min="60"><button class="btn teal">Add DNS Record</button></form><div>${Array.isArray(records)&&records.length?records.map(r=>`<div class="domain-row"><div><strong>${r.type||r.Type} ${r.name||r.host||r.Name}</strong><br><span class="small">${r.value||r.content||r.Value} • TTL ${r.ttl||r.TTL||''}</span></div><button class="btn" onclick="deleteDnsRecord('${domain}','${r.id||r.recordId||r.Id}')">Delete</button></div>`).join(''):'No DNS records returned.'}</div><hr><form class="form" onsubmit="updateNameservers(event,'${domain}')"><input name="ns1" placeholder="ns1.example.com" required><input name="ns2" placeholder="ns2.example.com" required><button class="btn">Update Nameservers</button></form></div>`; }catch(e){el.innerHTML=`<div class="notice">${e.message}</div>`;}
}
async function addDnsRecord(e,domain){ e.preventDefault(); const body=Object.fromEntries(new FormData(e.target)); body.ttl=Number(body.ttl||3600); try{await apiJson(`${API_BASE}/domains/${encodeURIComponent(domain)}/dns`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify(body)}); await openDnsManager(domain);}catch(err){alert(err.message);} }
async function deleteDnsRecord(domain,id){ if(!id||!confirm('Delete this DNS record?')) return; try{await apiJson(`${API_BASE}/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${getToken()}`}}); await openDnsManager(domain);}catch(err){alert(err.message);} }
async function updateNameservers(e,domain){e.preventDefault();const f=new FormData(e.target);try{await apiJson(`${API_BASE}/domains/${encodeURIComponent(domain)}/nameservers`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({nameservers:[f.get('ns1'),f.get('ns2')]})});alert('Nameservers updated.');}catch(err){alert(err.message);} }


function protectPrivatePages(){
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const userPages=['dashboard.html','dashboard-cart.html','dashboard-register-domain.html','dashboard-dns-manager.html','dashboard-hosting.html','dashboard-business-email.html','dashboard-transfer-domain.html','dashboard-receive-domain.html','dashboard-support.html','dashboard-wallet.html','wallet-deposit.html','wallet-withdraw.html','wallet-send.html','wallet-transfer.html','wallet-receive.html','wallet-convert.html','dns-manager.html','domain-transfer.html','domain-receive.html'];
  if(userPages.includes(page)){
    if(!getToken()){ sessionStorage.setItem('worldnet_return_to',page); location.replace('signin.html'); return false; }
    if(localStorage.getItem('worldnet_pin_ok')!=='yes' && page!=='pin.html'){ sessionStorage.setItem('worldnet_return_to',page); location.replace('pin.html'); return false; }
  }
  if(page==='admin-dashboard.html' && !getAdminToken()){ location.replace('admin-login.html'); return false; }
  return true;
}

function setupResponsiveNavigation(){
  const header=document.querySelector('.top-nav');
  if(!header) return;
  let toggle=header.querySelector('.nav-toggle');
  if(!toggle){
    toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='nav-toggle';
    toggle.setAttribute('aria-label','Open navigation menu');
    toggle.setAttribute('aria-expanded','false');
    toggle.innerHTML='<span class="nav-toggle-icon">☰</span><span class="nav-toggle-label">Menu</span>';
    const logo=header.querySelector('.logo');
    if(logo) logo.insertAdjacentElement('afterend',toggle); else header.prepend(toggle);
  }
  toggle.addEventListener('click',()=>{
    const open=header.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
    toggle.innerHTML=open?'<span class="nav-toggle-icon">×</span><span class="nav-toggle-label">Close</span>':'<span class="nav-toggle-icon">☰</span><span class="nav-toggle-label">Menu</span>';
  });
  header.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
    if(window.innerWidth<=900){header.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<span class="nav-toggle-icon">☰</span><span class="nav-toggle-label">Menu</span>';}
  }));
  window.addEventListener('resize',()=>{
    if(window.innerWidth>900){header.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<span class="nav-toggle-icon">☰</span><span class="nav-toggle-label">Menu</span>';}
  });
}

function secureDashboardLinks(){
  document.querySelectorAll('a[href="dashboard.html"],a[data-dashboard-link]').forEach(a=>a.addEventListener('click',e=>{
    if(!getToken()){ e.preventDefault(); sessionStorage.setItem('worldnet_return_to','dashboard.html'); location.href='index.html'; }
    else if(localStorage.getItem('worldnet_pin_ok')!=='yes'){ e.preventDefault(); sessionStorage.setItem('worldnet_return_to','dashboard.html'); location.href='pin.html'; }
  }));
}
function injectAccountActions(){
  const nav=document.querySelector('.nav-right'); if(!nav) return;
  nav.querySelectorAll('[data-user-logout],.public-logout-link,[data-dashboard-link]').forEach((el,i)=>{ if(i>0) el.remove(); });
  const token=getToken();
  const auth=nav.querySelector('.nav-auth-link');
  if(token){
    nav.querySelectorAll('a[href="signin.html"],a[href="signup.html"]').forEach(x=>{ if(x!==auth)x.remove(); });
    if(auth){ auth.textContent='Dashboard'; auth.href='dashboard.html'; auth.dataset.dashboardLink=''; }
    if(!nav.querySelector('[data-user-logout]')){
      const b=document.createElement('button'); b.type='button'; b.className='nav-item nav-button public-logout-link'; b.dataset.userLogout=''; b.textContent='Logout'; b.addEventListener('click',logoutUser);
      const cart=nav.querySelector('.cart'); nav.insertBefore(b,cart||null);
    }
  } else if(auth){ auth.textContent='Joinfree'; auth.href='signin.html'; auth.removeAttribute('data-dashboard-link'); }
  if(getAdminToken() && location.pathname.endsWith('admin-dashboard.html') && !nav.querySelector('[data-admin-logout]')){
    const b=document.createElement('button'); b.type='button'; b.className='nav-item nav-button'; b.dataset.adminLogout=''; b.textContent='Admin Logout'; b.addEventListener('click',logoutAdmin); nav.prepend(b);
  }
}
window.openDnsManager=openDnsManager; window.addDnsRecord=addDnsRecord; window.deleteDnsRecord=deleteDnsRecord; window.updateNameservers=updateNameservers;
window.logoutUser=logoutUser; window.logoutAdmin=logoutAdmin; window.addToCart=addToCart; window.markMessage=markMessage; window.replyMessage=replyMessage; window.payWithPaystack=payWithPaystack; window.createOrder=createOrder;

document.addEventListener('DOMContentLoaded', async ()=>{
  if(!protectPrivatePages()) return;
  setupResponsiveNavigation(); secureDashboardLinks(); injectAccountActions(); ensureDashboardCartButton(); setupDashboardMobileMenu(); setupDashboardSidebar();
  await initCurrency(); injectCurrencySelector(); refreshCurrencyUI();
  updateCartCount(); loadPlans(); renderCart(); loadAdmin(); loadDashboard(); setupPinPage(); setupSupportChat();
  document.querySelectorAll('[data-domain-search]').forEach(b=>b.addEventListener('click',()=>searchDomains('', b)));
  document.querySelectorAll('form[data-contact]').forEach(f=>f.addEventListener('submit',submitContact));
  $('#signup-form')?.addEventListener('submit', handleSignup);
  $('#login-form')?.addEventListener('submit', handleLogin);
  $('#admin-login-form')?.addEventListener('submit', handleAdminLogin);
  setupGitHubAuthLinks();
});


const WNHDomainOps={
 token(){return localStorage.getItem('worldnet_token')||''},
 async api(path,opts={}){const headers={...(opts.headers||{}),'Content-Type':'application/json'};const t=this.token();if(t)headers.Authorization=`Bearer ${t}`;const r=await fetch(`${API_BASE}${path.replace(/^\/api/,'')}`,{...opts,headers});const data=await r.json().catch(()=>({message:'Unexpected server response'}));if(!r.ok)throw new Error(data.message||'Request failed');return data},
 async loadManagedDomains(){const box=document.getElementById('managed-domains');if(!box)return;try{const domains=await this.api('/api/domains/managed');if(!domains.length){box.innerHTML='<div class="status-box">No managed domains are connected to this account yet.</div>';return}box.innerHTML=domains.map(d=>`<div class="domain-item"><div><strong>${d.domain}</strong><small>Status: ${d.status||'active'}</small></div><button class="btn" onclick="WNHDomainOps.openDns('${d.domain}')">Manage DNS</button></div>`).join('')}catch(e){box.innerHTML=`<div class="status-box">${e.message}. Please sign in first.</div>`}},
 recordId(r){return r.id||r.recordId||r.Id||r._id||''},
 recordType(r){return r.type||r.recordType||r.Type||''},
 recordName(r){return r.name||r.host||r.Name||'@'},
 recordValue(r){return r.value||r.content||r.target||r.Value||''},
 renderRecords(records=[]){const box=document.getElementById('dns-records');if(!box)return;box.innerHTML=records.length?records.map(r=>{const id=this.recordId(r),type=this.recordType(r),name=this.recordName(r),value=this.recordValue(r),ttl=r.ttl||r.TTL||3600,priority=r.priority??r.Priority??'';const encoded=encodeURIComponent(JSON.stringify({id,type,name,value,ttl,priority}));return `<div class="domain-item"><div><strong>${type} ${name}</strong><small>${value} · TTL ${ttl}${priority!==''?` · Priority ${priority}`:''}</small></div><div><button class="btn" onclick="WNHDomainOps.editRecord('${encoded}')">Edit</button> <button class="btn btn-secondary" onclick="WNHDomainOps.deleteRecord('${id}')">Delete</button></div></div>`}).join(''):'<div class="status-box">No DNS records returned by the provider.</div>'},
 async openDns(domain){const panel=document.getElementById('dns-editor');panel.hidden=false;document.getElementById('dns-title').textContent=`DNS settings for ${domain}`;document.getElementById('dns-domain').value=domain;try{const d=await this.api(`/api/domains/${encodeURIComponent(domain)}/dns`);['ns1','ns2','ns3','ns4'].forEach((id,i)=>document.getElementById(id).value=(d.nameservers||[])[i]||'');this.renderRecords(d.records||[]);panel.scrollIntoView({behavior:'smooth'})}catch(e){document.getElementById('dns-status').innerHTML=`<div class="status-box">${e.message}</div>`}},
 editRecord(encoded){const r=JSON.parse(decodeURIComponent(encoded));document.getElementById('dns-record-id').value=r.id||'';document.getElementById('dns-record-type').value=r.type;document.getElementById('dns-record-name').value=r.name;document.getElementById('dns-record-value').value=r.value;document.getElementById('dns-record-ttl').value=r.ttl||3600;document.getElementById('dns-record-priority').value=r.priority??'';document.getElementById('dns-record-cancel').hidden=false},
 resetRecord(){document.getElementById('dns-record-form')?.reset();document.getElementById('dns-record-id').value='';document.getElementById('dns-record-name').value='@';document.getElementById('dns-record-ttl').value='3600';document.getElementById('dns-record-cancel').hidden=true},
 async deleteRecord(id){if(!id||!confirm('Delete this DNS record?'))return;const domain=document.getElementById('dns-domain').value,out=document.getElementById('dns-status');try{const d=await this.api(`/api/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(id)}`,{method:'DELETE'});out.innerHTML=`<div class="status-box">${d.message}</div>`;await this.openDns(domain)}catch(e){out.innerHTML=`<div class="status-box">${e.message}</div>`}},
 bindTransfer(){const f=document.getElementById('transfer-form');if(!f)return;f.addEventListener('submit',async e=>{e.preventDefault();const out=document.getElementById('transfer-status');out.innerHTML='<div class="status-box">Submitting securely...</div>';try{const d=await this.api('/api/domains/transfers',{method:'POST',body:JSON.stringify({domain:document.getElementById('transfer-domain').value,authCode:document.getElementById('transfer-code').value,email:document.getElementById('transfer-email').value,consent:document.getElementById('transfer-consent').checked})});out.innerHTML=`<div class="status-box">${d.message} Reference: ${d.reference}</div>`;f.reset()}catch(err){out.innerHTML=`<div class="status-box">${err.message}</div>`}})},
 bindReceive(){const f=document.getElementById('receive-form');if(!f)return;f.addEventListener('submit',async e=>{e.preventDefault();const out=document.getElementById('receive-status');out.innerHTML='<div class="status-box">Creating request...</div>';try{const d=await this.api('/api/domains/receive-requests',{method:'POST',body:JSON.stringify({domain:document.getElementById('receive-domain').value,senderEmail:document.getElementById('sender-email').value,note:document.getElementById('receive-note').value,consent:document.getElementById('receive-consent').checked})});out.innerHTML=`<div class="status-box">${d.message} Reference: ${d.reference}</div>`;f.reset()}catch(err){out.innerHTML=`<div class="status-box">${err.message}</div>`}})}
};
document.addEventListener('submit',async e=>{if(e.target.id==='nameserver-form'){e.preventDefault();const domain=document.getElementById('dns-domain').value;const nameservers=['ns1','ns2','ns3','ns4'].map(id=>document.getElementById(id).value.trim()).filter(Boolean);const out=document.getElementById('dns-status');try{const d=await WNHDomainOps.api(`/api/domains/${encodeURIComponent(domain)}/nameservers`,{method:'PUT',body:JSON.stringify({nameservers})});out.innerHTML=`<div class="status-box">${d.message}</div>`}catch(err){out.innerHTML=`<div class="status-box">${err.message}</div>`}}if(e.target.id==='dns-record-form'){e.preventDefault();const domain=document.getElementById('dns-domain').value,id=document.getElementById('dns-record-id').value;const payload={type:document.getElementById('dns-record-type').value,name:document.getElementById('dns-record-name').value,value:document.getElementById('dns-record-value').value,ttl:Number(document.getElementById('dns-record-ttl').value||3600),priority:document.getElementById('dns-record-priority').value};const out=document.getElementById('dns-status');try{const path=`/api/domains/${encodeURIComponent(domain)}/dns${id?`/${encodeURIComponent(id)}`:''}`;const d=await WNHDomainOps.api(path,{method:id?'PUT':'POST',body:JSON.stringify(payload)});out.innerHTML=`<div class="status-box">${d.message}</div>`;WNHDomainOps.resetRecord();await WNHDomainOps.openDns(domain)}catch(err){out.innerHTML=`<div class="status-box">${err.message}</div>`}}});
document.addEventListener('click',e=>{if(e.target.id==='dns-record-cancel')WNHDomainOps.resetRecord()});


async function initializeWalletDeposit(event){
  event.preventDefault();
  const form=event.currentTarget, out=document.getElementById('wallet-deposit-status'), button=form.querySelector('button[type=submit]');
  const fd=new FormData(form), amount=Number(fd.get('amount')||0), currency=String(fd.get('currency')||'NGN');
  const minimum=currency==='NGN'?100:1;
  if(amount<minimum){out.textContent=`Minimum deposit is ${minimum} ${currency}.`;return;}
  button.disabled=true; button.textContent='Connecting...'; out.textContent='A 4% platform service fee will be added. Connecting securely to Paystack...';
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
  try{
    const data=await apiJson(`${API_BASE}/payments/paystack/initialize`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({amount,currency,purpose:'wallet_deposit'})});
    if(!data?.data?.authorization_url) throw new Error(data.message||'Paystack did not return a payment link.');
    out.textContent='Redirecting to secure payment...';
    window.location.assign(data.data.authorization_url);
  }catch(e){out.textContent=e.name==='AbortError'?'Paystack connection timed out. Please check the backend and try again.':e.message;button.disabled=false;button.textContent='Deposit';}
  finally{clearTimeout(timer);}
}

async function initializeSystemWalletDeposit(event){
  event.preventDefault();
  const form=event.currentTarget, out=document.getElementById('system-wallet-deposit-status'), button=form.querySelector('button[type=submit]');
  const amount=Number(new FormData(form).get('amount')||0);
  if(amount<100){out.textContent='Minimum deposit is 100 NGN.';return;}
  button.disabled=true; button.textContent='Connecting...'; out.textContent='Connecting securely to Paystack...';
  try{
    const data=await apiJson(`${API_BASE}/payments/paystack/initialize`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getAdminToken()||getToken()}`},body:JSON.stringify({amount,currency:'NGN',purpose:'system_wallet_deposit',metadata:{wallet_type:'system'}})});
    if(!data?.data?.authorization_url) throw new Error(data.message||'Paystack did not return a payment link.');
    out.textContent='Redirecting to secure payment...'; window.location.assign(data.data.authorization_url);
  }catch(e){out.textContent=e.message;button.disabled=false;button.textContent='Deposit to System Wallet';}
}


function updatePublicAuthNavigation(){ if(!document.body.classList.contains('dashboard-body')) injectAccountActions(); }

async function domainAction(domain,action,payload={}){
  const methods={renew:'POST',lock:'PUT',contact:'PUT'};
  const path=action==='epp'?`/domains/${encodeURIComponent(domain)}/epp`:`/domains/${encodeURIComponent(domain)}/${action}`;
  try{
    const data=await apiJson(`${API_BASE}${path}`,{method:action==='epp'?'GET':methods[action],headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:action==='epp'?undefined:JSON.stringify(payload)});
    if(action==='epp'&&data.authCode) prompt('Copy your EPP/Auth code:',data.authCode); else alert(data.message||'Completed successfully.');
    loadDashboard();
  }catch(e){alert(e.message);}
}

async function submitWalletWithdrawal(event){
  event.preventDefault(); const form=event.currentTarget,out=document.getElementById('wallet-withdraw-status'),button=form.querySelector('button');
  button.disabled=true;out.textContent='Submitting secure withdrawal request…';
  try{const body=Object.fromEntries(new FormData(form));body.amount=Number(body.amount||0);const data=await apiJson(`${API_BASE}/wallet/withdrawals`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify(body)});out.textContent=data.message;form.reset();loadDashboard();}catch(e){out.textContent=e.message;}finally{button.disabled=false;}
}
document.addEventListener('submit',e=>{if(e.target.id==='wallet-withdraw-form')submitWalletWithdrawal(e)});

window.initializeWalletDeposit=initializeWalletDeposit;window.initializeSystemWalletDeposit=initializeSystemWalletDeposit;window.domainAction=domainAction;




async function loadWalletBanking(){
 const host=document.getElementById('wallet-banking-content'); if(!host||!getToken()&&!getAdminToken())return;
 const token=getAdminToken()||getToken();
 try{const summary=await apiJson(`${API_BASE}/wallet/banking/summary`,{headers:{Authorization:`Bearer ${token}`}});const fee=Number(summary.platformFeePercent||0);const dva=summary.dedicatedAccount||{};
 host.innerHTML=`<div><p class="app-kicker">Banking tools</p><h2>Transfer, Receive & Convert</h2><p class="small">${summary.role==='admin'?'Administrator operations use the real Paystack amount without platform markup.':`${fee}% platform fee applies to transfers, received funds and conversions.`}</p></div>
 <div class="banking-forms">
 <form id="bank-transfer-form" class="banking-form"><h3>Transfer to Bank</h3><input name="amount" type="number" min="100" step="0.01" placeholder="Amount" required><select name="currency"><option>NGN</option><option>GHS</option><option>KES</option><option>ZAR</option></select><select name="bankCode" id="bank-transfer-bank" required><option value="">Select bank</option></select><input name="accountNumber" inputmode="numeric" placeholder="Account number" required><input name="accountName" placeholder="Resolved account name" readonly required><textarea name="reason" rows="2" placeholder="Transfer reason"></textarea><span class="fee-inline">Fee: ${fee}% · Paystack Transfer must be enabled.</span><button class="btn teal">Transfer</button><div class="small form-status"></div></form>
 <div class="banking-form"><h3>Receive from Any Bank</h3><div class="receive-account">${summary.role==='admin'?'Use your Paystack business settlement/collection account. Admin receives at the real API amount.':dva.active?`<b>${escapeHtml(dva.bankName||'Paystack Bank')}</b><br>${escapeHtml(dva.accountNumber||'')}<br>${escapeHtml(dva.accountName||'')}`:'Create a dedicated Paystack bank account for this wallet.'}</div>${summary.role==='admin'?'':'<button id="create-receive-account" class="btn teal" type="button">Create Receive Account</button>'}<div id="receive-account-status" class="small"></div></div>
 <form id="wallet-convert-form" class="banking-form"><h3>Convert Banking Balance</h3><input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required><select name="fromCurrency">${['NGN','USD','GHS','KES','ZAR','GBP','EUR'].map(x=>`<option>${x}</option>`).join('')}</select><select name="toCurrency">${['USD','NGN','GHS','KES','ZAR','GBP','EUR'].map(x=>`<option>${x}</option>`).join('')}</select><span class="fee-inline">Live exchange rate · ${fee}% fee for non-admin roles.</span><button class="btn teal">Convert</button><div class="small form-status"></div></form></div>
 <div class="banking-history"><h3>Recent banking activity</h3>${(summary.operations||[]).length?(summary.operations||[]).map(o=>`<div class="banking-history-item"><span><b>${escapeHtml(String(o.type||'').replaceAll('_',' '))}</b><br>${new Date(o.createdAt).toLocaleString()}</span><span>${money(o.amount,o.currency)}<br><span class="badge">${escapeHtml(o.status)}</span></span></div>`).join(''):'<p class="small">No banking activity yet.</p>'}</div>`;
 await populateTransferBanks('NGN');
 const tf=document.getElementById('bank-transfer-form');tf?.querySelector('[name=currency]')?.addEventListener('change',e=>populateTransferBanks(e.target.value));tf?.querySelector('[name=accountNumber]')?.addEventListener('blur',resolveTransferAccount);
 tf?.addEventListener('submit',submitBankTransfer);document.getElementById('wallet-convert-form')?.addEventListener('submit',submitWalletConvert);document.getElementById('create-receive-account')?.addEventListener('click',createReceiveAccount);
 }catch(e){host.innerHTML=`<div class="notice">${escapeHtml(e.message)}</div>`;}
}
async function populateTransferBanks(currency){const select=document.getElementById('bank-transfer-bank');if(!select)return;select.innerHTML='<option value="">Loading banks…</option>';try{const banks=await apiJson(`${API_BASE}/wallet/banking/banks?currency=${encodeURIComponent(currency)}`,{headers:{Authorization:`Bearer ${getAdminToken()||getToken()}`}});select.innerHTML='<option value="">Select bank</option>'+banks.map(b=>`<option value="${escapeHtml(b.code)}">${escapeHtml(b.name)}</option>`).join('');}catch(e){select.innerHTML='<option value="">Banks unavailable</option>';}}
async function resolveTransferAccount(e){const form=e.target.form,number=e.target.value,bankCode=form.bankCode.value;if(!number||!bankCode)return;const out=form.querySelector('.form-status');out.textContent='Verifying account…';try{const d=await apiJson(`${API_BASE}/wallet/banking/resolve-account?accountNumber=${encodeURIComponent(number)}&bankCode=${encodeURIComponent(bankCode)}`,{headers:{Authorization:`Bearer ${getAdminToken()||getToken()}`}});form.accountName.value=d.account_name||'';out.textContent='Account verified.';}catch(x){form.accountName.value='';out.textContent=x.message;}}
async function submitBankTransfer(e){e.preventDefault();const form=e.currentTarget,out=form.querySelector('.form-status'),button=form.querySelector('button');button.disabled=true;out.textContent='Submitting transfer…';try{const body=Object.fromEntries(new FormData(form));body.amount=Number(body.amount);const d=await apiJson(`${API_BASE}/wallet/banking/transfer`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getAdminToken()||getToken()}`},body:JSON.stringify(body)});out.textContent=d.message;form.reset();await loadWalletBanking();}catch(x){out.textContent=x.message;}finally{button.disabled=false;}}
async function createReceiveAccount(){const out=document.getElementById('receive-account-status');out.textContent='Creating secure bank account…';try{const d=await apiJson(`${API_BASE}/wallet/banking/receive-account`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:'{}'});out.textContent=d.message;await loadWalletBanking();}catch(x){out.textContent=x.message;}}
async function submitWalletConvert(e){e.preventDefault();const form=e.currentTarget,out=form.querySelector('.form-status'),button=form.querySelector('button');button.disabled=true;out.textContent='Converting…';try{const body=Object.fromEntries(new FormData(form));body.amount=Number(body.amount);const d=await apiJson(`${API_BASE}/wallet/banking/convert`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getAdminToken()||getToken()}`},body:JSON.stringify(body)});out.textContent=d.message;await loadWalletBanking();}catch(x){out.textContent=x.message;}finally{button.disabled=false;}}
document.addEventListener('DOMContentLoaded',loadWalletBanking);

document.addEventListener('DOMContentLoaded',updatePublicAuthNavigation);
