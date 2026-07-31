// Dashboard iframe mode: keep service content only and avoid a duplicate navigation shell.
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
const API_BASE = String(WORLDNET_CONFIG.API_BASE_URL || window.WORLDNET_API_BASE || '/api').replace(/\/$/,'');
const API_CANDIDATES = [...new Set((WORLDNET_CONFIG.API_CANDIDATES || window.WORLDNET_API_CANDIDATES || [API_BASE]).map(value=>String(value||'').replace(/\/$/,'')).filter(Boolean))];
const PAYSTACK_PUBLIC_KEY = WORLDNET_CONFIG.PAYSTACK_PUBLIC_KEY || window.PAYSTACK_PUBLIC_KEY || '';
const $ = (s) => document.querySelector(s);
const cart = JSON.parse(localStorage.getItem('world_net_hosting_cart') || '[]');
let currencyConfig = { countryCurrency: {}, supportedPaystackCurrencies: ['NGN'], displayCurrencies: ['USD','NGN','GHS','KES','ZAR','GBP','EUR'], paystackDefaultCurrency: 'NGN' };
let preferredCurrency = localStorage.getItem('worldnet_currency') || 'USD';
let usdToLocalRate = Number(localStorage.getItem(`worldnet_rate_USD_${preferredCurrency}`) || 1);

async function fetchDomainApi(path,options={}){
  const failures=[];
  for(const base of API_CANDIDATES){
    try{
      const response=await fetch(`${base}${path}`,options);
      if(response.status===404 && API_CANDIDATES.length>1){failures.push(`${base}: HTTP 404`);continue;}
      return response;
    }catch(error){
      if(error?.name==='AbortError') throw error;
      failures.push(`${base}: ${error?.message||'network error'}`);
    }
  }
  const error=new Error('The domain API could not be reached. Confirm the backend Render service is live and that its CORS FRONTEND_URL includes this website.');
  error.details=failures;
  throw error;
}

async function readApiResponse(response){
  const contentType=String(response.headers.get('content-type')||'').toLowerCase();
  const text=await response.text();
  if(!text) return {};
  if(contentType.includes('application/json')){
    try{return JSON.parse(text);}catch(_){throw new Error(`Backend returned invalid JSON (${response.status}).`);}
  }
  const clean=text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  throw new Error(clean && clean.length<180 ? clean : `Backend route unavailable (${response.status}). Check the API base URL.`);
}

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
function setStatus(message){ const out = $('#auth-status') || $('#form-status') || $('#chat-status'); if(out){ out.style.display='block'; out.textContent = message; } }
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
  if(page==='staff.htm') return;
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
  let closeButton=sidebar.querySelector('.app-sidebar-close');
  if(!closeButton){
    closeButton=document.createElement('button');
    closeButton.type='button';
    closeButton.className='app-sidebar-close';
    closeButton.setAttribute('aria-label','Close dashboard menu');
    closeButton.innerHTML='<span aria-hidden="true">×</span><span>Close</span>';
    sidebar.prepend(closeButton);
  }
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
  closeButton.addEventListener('click',()=>setOpen(false));
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

function publicCurrencyMeta(code){
  const currency=String(code||'USD').toUpperCase();
  const label=(window.WNH_CURRENCIES||[]).find(item=>item[0]===currency)?.[1]||currency;
  let formatted;
  try{formatted=new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'narrowSymbol'}).format(0);}catch(_){formatted=`${currency} 0.00`;}
  return {currency,label,formatted};
}
function renderPublicCurrencyBalances(){
  document.querySelectorAll('[data-public-currency-balances]').forEach(grid=>{
    const chosen=String(localStorage.getItem('worldnet_currency')||preferredCurrency||'USD').toUpperCase();
    const codes=[...new Set([chosen,'USD','EUR','GBP'])].slice(0,4);
    grid.innerHTML=codes.map((code,index)=>{
      const info=publicCurrencyMeta(code);
      if(grid.dataset.publicCurrencyBalances==='home'){
        return `<article><small>${escapeHtml(info.currency)} WALLET${index===0?' · SELECTED':''}</small><strong>${escapeHtml(info.formatted)}</strong><span>${escapeHtml(info.label)} balance</span></article>`;
      }
      return `<article class="public-balance-card"><span>${escapeHtml(info.label)} balance${index===0?' · Selected':''}</span><strong>${escapeHtml(info.formatted)}</strong><small>${index===0?'Change currency from the top menu':'International wallet preview'}</small></article>`;
    }).join('');
  });
}
window.addEventListener('worldnet:currency-changed',renderPublicCurrencyBalances);
document.addEventListener('wnh:currency-changed',renderPublicCurrencyBalances);
document.addEventListener('DOMContentLoaded',renderPublicCurrencyBalances);
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
const DOMAIN_LIVE_DEBOUNCE_MS=320;
const domainClientCache=new Map();
let domainSearchController=null;
let domainLiveTimer=null;
let domainResultState={box:null,results:[],visible:DOMAIN_RESULTS_COLLAPSED_COUNT,query:''};

function normalizedDomainQuery(value){
  let query=String(value||'').trim().toLowerCase()
    .replace(/^https?:\/\//,'').replace(/^www\./,'')
    .replace(/\s+/g,'').replace(/[^a-z0-9.-]/g,'');
  if(query && !query.includes('.')) query += '.com';
  return query;
}

function domainStatusMarkup(item){
  if(item.available===true) return '<span class="badge domain-badge-available">Available</span>';
  if(item.premium) return '<span class="badge domain-badge-premium">Premium</span>';
  if(item.available===false) return '<span class="badge domain-badge-taken">Taken</span>';
  return '<span class="badge domain-badge-pending">Not verified</span>';
}

function renderDomainResults(){
  const {box,results}=domainResultState;
  if(!box) return;
  box.classList.remove('domain-results-loading');
  if(!results.length){
    box.innerHTML='<div class="domain-empty-state"><strong>No domain result was returned.</strong><span>Check the spelling or try another extension.</span></div>';
    return;
  }
  const visible=Math.min(domainResultState.visible,results.length);
  const rows=results.slice(0,visible).map(d=>{
    const firstYearPrice=Number(d.firstYearPrice ?? d.price ?? 0);
    const renewalPrice=Number(d.renewalPrice ?? firstYearPrice);
    const priceBlock=d.available===true && Number.isFinite(firstYearPrice) && firstYearPrice>0
      ? `<div class="domain-price-action"><strong>${dualMoney(firstYearPrice)}/1st yr</strong><span class="small">Renews at ${dualMoney(renewalPrice)}/yr</span><button class="btn teal" onclick='addToCart({type:"domain",domain:"${escapeHtml(d.domain)}",name:"${escapeHtml(d.domain)}",period:1,usdPrice:${firstYearPrice},price:${firstYearPrice},renewalPrice:${renewalPrice},currency:"USD"})'>Add to cart</button></div>`
      : d.available===false ? '<div class="domain-unavailable-copy"><strong>Not available</strong><span class="small">Try another extension</span></div>'
      : '<div class="domain-unavailable-copy"><strong>Registry result unavailable</strong><span class="small">Search again shortly</span></div>';
    return `<div class="domain-row domain-live-row"><div class="domain-name-status"><strong>${escapeHtml(d.domain)}</strong>${domainStatusMarkup(d)}<span class="small">${escapeHtml(d.message || (d.available ? 'Available to register' : 'Already registered'))}</span></div>${priceBlock}</div>`;
  }).join('');
  const hasMore=visible<results.length;
  const canCollapse=visible>DOMAIN_RESULTS_COLLAPSED_COUNT;
  const summary=results.length===1?'Live domain result':'Live domain results';
  box.innerHTML=`<div class="domain-results-summary"><strong>${summary}</strong><span>Verified through the domain provider</span></div><div class="domain-result-list">${rows}</div><div class="domain-result-controls">${hasMore?'<button type="button" class="btn teal" data-domain-show-more>Show More</button>':''}${canCollapse?'<button type="button" class="btn domain-show-less" data-domain-show-less>Show Less</button>':''}</div>`;
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

function ensureDomainResultsBox(trigger,input){
  const localContainer=(trigger instanceof Element ? trigger : input)?.closest('.search-strip, .hero, .main, form');
  let box=localContainer?.querySelector('#domain-results, .domain-results-host') || null;
  if(box) return box;
  box=document.getElementById('domain-results');
  if(box && (!localContainer || localContainer.contains(box))) return box;
  const host=document.createElement('div');
  host.className='result-box domain-results-host';
  host.setAttribute('data-domain-results','');
  if(localContainer?.classList.contains('search-strip')) localContainer.insertAdjacentElement('afterend',host);
  else if(localContainer) localContainer.appendChild(host);
  else (document.querySelector('main')||document.body).prepend(host);
  return host;
}

async function searchDomains(query, trigger, options={}){
  let input=null;
  if(trigger instanceof Element){
    const container=trigger.closest('.search-box, .hero-search, form, .search-strip');
    input=container?.querySelector('.domain-input')||null;
  }
  if(!input) input=document.querySelector('.domain-input:focus')||document.querySelector('.domain-input');
  const q=normalizedDomainQuery(query||input?.value||'');
  const live=options.live===true;
  const limit=DOMAIN_RESULTS_COLLAPSED_COUNT;
  if(!q){
    if(!live) showToast('Enter a domain name, for example example.com','warning');
    return;
  }
  const box=ensureDomainResultsBox(trigger,input);
  if(!box) return;
  box.setAttribute('aria-live','polite');
  box.style.display='block';
  box.classList.add('domain-results-loading');
  box.innerHTML=`<div class="domain-inline-loading" role="status"><span class="domain-loading-spinner" aria-hidden="true"></span><span>Checking <strong>${escapeHtml(q)}</strong>…</span></div>`;

  const cacheKey=`${q}:${limit}`;
  const cached=domainClientCache.get(cacheKey);
  if(cached && Date.now()-cached.time<120000){
    domainResultState={box,results:cached.results,visible:Math.min(limit,cached.results.length),query:q};
    renderDomainResults();
    return;
  }

  domainSearchController?.abort();
  domainSearchController=new AbortController();
  try{
    const res=await fetchDomainApi(`/domains/search?name=${encodeURIComponent(q)}&limit=${limit}&quick=${live?'1':'0'}`,{
      signal:domainSearchController.signal,
      headers:{Accept:'application/json'},
      cache:'no-store'
    });
    const text=await res.text();
    let data; try{data=JSON.parse(text)}catch{throw new Error(text||`Domain API returned HTTP ${res.status}`)}
    if(!res.ok) throw new Error(data.message||'Live domain search failed');
    const results=Array.isArray(data.results)?data.results:[];
    domainClientCache.set(cacheKey,{time:Date.now(),results});
    domainResultState={box,results,visible:Math.min(limit,results.length),query:q};
    renderDomainResults();
  }catch(error){
    if(error.name==='AbortError') return;
    box.classList.remove('domain-results-loading');
    box.innerHTML=`<div class="domain-error-state"><strong>Domain search could not finish.</strong><span>${escapeHtml(error.message||'Verify the backend and provider connection.')}</span><button type="button" class="btn teal" data-domain-retry>Try again</button></div>`;
    box.querySelector('[data-domain-retry]')?.addEventListener('click',()=>searchDomains(q,trigger,options));
  }
}

function setupLiveDomainSearch(){
  document.querySelectorAll('.domain-input').forEach(input=>{
    input.setAttribute('autocomplete','off');
    input.setAttribute('spellcheck','false');
    input.addEventListener('input',()=>{
      clearTimeout(domainLiveTimer);
      const raw=String(input.value||'').trim();
      if(raw.length<2){
        const box=ensureDomainResultsBox(null,input);
        if(box){box.style.display='none';box.innerHTML='';}
        domainSearchController?.abort();
        return;
      }
      domainLiveTimer=setTimeout(()=>searchDomains(raw,null,{live:true}),DOMAIN_LIVE_DEBOUNCE_MS);
    });
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        event.preventDefault();
        clearTimeout(domainLiveTimer);
        searchDomains(input.value,null,{live:false});
      }
    });
  });
}

async function submitContact(e){
  e.preventDefault();
  const form = e.target; const payload = Object.fromEntries(new FormData(form));
  const out = $('#form-status'); if(out) out.textContent = 'Sending...';
  try{ const res = await fetch(`${API_BASE}/contact`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await readApiResponse(res); if(!res.ok) throw new Error(data.message||`Request failed (${res.status})`); if(out) out.textContent = data.message || 'Message submitted'; form.reset(); }
  catch(err){ if(out) out.textContent = 'The backend API is unavailable. Start the API to save messages.'; }
}

async function loadPlans(){
  const el = $('#plans'); if(!el) return;
  try{ const res = await fetch(`${API_BASE}/plans`); const plans = await readApiResponse(res); if(!res.ok) throw new Error(plans.message||`Request failed (${res.status})`); el.innerHTML = plans.map(p=>`<div class="card"><h3>${p.name}</h3><p>${p.description}</p><div class="price">${dualMoney(p.price)}<span class="small">/${p.billing}</span></div><button class="btn teal" onclick='addToCart({type:"plan",name:"${p.name}",usdPrice:${p.price},price:${p.price},currency:"USD"})'>Choose Plan</button><div class="feature-list">${(p.features || []).map(f=>`<span>${f}</span>`).join('')}</div></div>`).join(''); }catch(e){}
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
 try{ const res=await fetch(`${API_BASE}/orders`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({items:cart})}); const data=await readApiResponse(res); if(!res.ok) throw new Error(data.message || 'Order failed'); showToast(`${data.message}. Total ${money(data.total, data.currency || 'USD')}`,'success'); localStorage.removeItem('world_net_hosting_cart'); cart.splice(0,cart.length); setTimeout(()=>renderCart(),500); }
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




async function authRequest(path, payload){
  try {
    return await apiJson(`${API_BASE}${path}`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(payload)});
  } catch (error) {
    if (/404|route unavailable|route not found/i.test(String(error?.message || ''))) {
      throw new Error(`Authentication endpoint was not found at ${API_BASE}${path}. Start the backend on port 10000 locally or configure WORLDNET_API_BASE_URL in the frontend environment.`);
    }
    throw error;
  }
}
function setFormBusy(form,busy,label){
  const button=form?.querySelector('button[type="submit"],button:not([type])');
  if(!button)return;
  if(!button.dataset.originalText)button.dataset.originalText=button.textContent;
  button.disabled=busy;
  button.textContent=busy?label:(button.dataset.originalText||'Continue');
}
async function handleSignup(event){
  event.preventDefault(); const form=event.currentTarget; setFormBusy(form,true,'Creating account…'); setStatus('Creating your secure account…');
  try{const payload=Object.fromEntries(new FormData(form));const data=await authRequest('/auth/signup',payload);saveSession(data);localStorage.removeItem('worldnet_pin_ok');location.replace('pin.html');}
  catch(error){setStatus(error.message||'Signup failed. Please check your details and try again.');}
  finally{setFormBusy(form,false);}
}
async function handleLogin(event){
  event.preventDefault(); const form=event.currentTarget; setFormBusy(form,true,'Signing in…'); setStatus('Checking your login details…');
  try{const payload=Object.fromEntries(new FormData(form));const data=await authRequest('/auth/login',payload);saveSession(data);localStorage.removeItem('worldnet_pin_ok');location.replace('pin.html');}
  catch(error){setStatus(error.message||'Login failed. Please check your email and password.');}
  finally{setFormBusy(form,false);}
}

async function handlePin(event){
  event.preventDefault(); const form=event.currentTarget; const mode=localStorage.getItem('worldnet_pin_mode')||'verify-pin'; setFormBusy(form,true,mode==='create-pin'?'Creating PIN…':'Checking PIN…');
  try{const payload=Object.fromEntries(new FormData(form));const data=await authTokenRequest(mode==='create-pin'?'/auth/pin/create':'/auth/pin/verify',payload);localStorage.setItem('worldnet_pin_ok','yes');localStorage.setItem('worldnet_user',JSON.stringify(data.user||JSON.parse(localStorage.getItem('worldnet_user')||'{}')));const savedUser=JSON.parse(localStorage.getItem('worldnet_user')||'{}');const next=sessionStorage.getItem('worldnet_return_to')||'dashboard.html';sessionStorage.removeItem('worldnet_return_to');location.replace(next);}
  catch(error){setStatus(error.message||'PIN request failed.');}
  finally{setFormBusy(form,false);}
}
async function authTokenRequest(path,payload,method='POST'){
  const res=await fetch(`${API_BASE}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()||''}`},body:JSON.stringify(payload)});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||`Request failed (${res.status})`);return data;
}
function payloadWithToken(payload){ return payload; }
async function handleRecovery(event){
  event.preventDefault();const form=event.currentTarget;const type=form.dataset.recovery;setFormBusy(form,true,'Updating…');setStatus('Updating your account securely…');
  try{const payload=Object.fromEntries(new FormData(form));const path=type==='password'?'/auth/password/reset-with-pin':'/auth/pin/reset-with-password';const data=await authRequest(path,payload);setStatus(data.message);form.reset();}
  catch(error){setStatus(error.message);}
  finally{setFormBusy(form,false);}
}
async function handleAccountUpdate(event){
  event.preventDefault();const form=event.currentTarget;if(!requireToken())return;setFormBusy(form,true,'Saving…');setStatus('Saving your account changes…');
  try{const payload=Object.fromEntries(new FormData(form));const data=await authTokenRequest('/auth/account',payload,'PATCH');localStorage.setItem('worldnet_token',data.token);localStorage.setItem('worldnet_user',JSON.stringify(data.user));setStatus(data.message);form.reset();}
  catch(error){setStatus(error.message);}
  finally{setFormBusy(form,false);}
}
function setupPasswordToggles(){
  // Password visibility uses one delegated listener so it works even when forms are rendered later.
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-password-toggle]');
  if(!button)return;
  event.preventDefault();
  const input=document.getElementById(button.dataset.passwordToggle);
  if(!input)return;
  const reveal=input.type==='password';
  input.type=reveal?'text':'password';
  button.textContent=reveal?'Hide':'Show';
  button.setAttribute('aria-pressed',String(reveal));
  button.setAttribute('aria-label',reveal?'Hide password':'Show password');
  input.focus({preventScroll:true});
});

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
 try{ const res=await fetch(`${API_BASE}/user/dashboard`,{headers:{Authorization:`Bearer ${getToken()}`}}); const data=await readApiResponse(res); if(!res.ok) throw new Error(data.message || `Dashboard request failed (${res.status})`); el.className=''; el.innerHTML=`<div class="cards dashboard-stats-grid"><div class="card dashboard-stat-card"><h3>Welcome</h3><p>${data.user.name}</p><span class="badge">${data.user.email}</span></div><div class="card dashboard-stat-card"><h3>Banking Balance</h3><div class="price">${money(data.wallet?.balance || 0, data.wallet?.currency || 'NGN')}</div></div><div class="card dashboard-stat-card"><h3>Orders</h3><div class="price">${data.summary.orders}</div></div><div class="card dashboard-stat-card"><h3>Registered Domains</h3><div class="price">${(data.domains||[]).length}</div></div></div><h2 style="margin-top:24px">My Domains & DNS</h2>${(data.domains||[]).length ? data.domains.map(d=>`<div class="domain-row"><div><strong>${d.domain}</strong><br><span class="small">${d.status} • ${(d.nameservers||[]).join(', ')}</span></div><div><button class="btn teal" onclick="openDnsManager('${d.domain}')">Manage DNS</button></div></div><div id="dns-${d.domain.replace(/[^a-z0-9]/gi,'-')}"></div>`).join('') : '<div class="notice">No registered domain yet. Complete payment for a domain to add it here.</div>'}<h2 style="margin-top:24px">Recent Orders</h2>${data.orders.length ? data.orders.map(o=>`<div class="domain-row"><div><strong>Order ${o._id}</strong><br><span class="small">${new Date(o.createdAt).toLocaleString()} • Domain: ${o.domainProvisionStatus||'not_started'}</span></div><div><strong>${money(o.total,o.currency || 'USD')}</strong> <span class="badge">${o.status}</span></div></div>`).join('') : '<div class="notice">No order yet.</div>'}`; }catch(e){ el.textContent=e.message; }
}


function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setupSupportChat(){
  const embedded=new URLSearchParams(location.search).get('dashboard_embed')==='1' && window.self!==window.top;
  if(embedded) return;
  const page=(location.pathname.split('/').pop()||'').toLowerCase();
  const noChatPages=['staff.htm','wallet-deposit.html','wallet-withdraw.html','wallet-send.html','wallet-transfer.html','wallet-receive.html','wallet-convert.html'];
  if(noChatPages.includes(page)) return;
  if($('#support-widget') || $('#support-chat-launcher')) return;
  const user=JSON.parse(localStorage.getItem('worldnet_user')||'{}');
  const language=localStorage.getItem('worldnet_language')||document.documentElement.lang||'en';
  const div=document.createElement('div'); div.id='support-widget';
  div.innerHTML=`<button id="support-chat-launcher" type="button" aria-label="Open live chat">💬</button><div class="chat-panel" aria-live="polite"><div class="chat-head"><strong>WNH Live Chat</strong><div><button type="button" class="chat-scroll-up" title="Scroll up">▲</button><button type="button" class="chat-scroll-down" title="Scroll down">▼</button><button type="button" class="chat-close" title="Close">×</button></div></div><div id="chat-thread" class="chat-thread"><p class="small">Messages reach support staff. Your message is also translated to English.</p></div><div class="chat-status-actions"><button type="button" data-chat-status="open">Open</button><button type="button" data-chat-status="closed">Close</button></div><form id="support-chat-form" class="chat-form" enctype="multipart/form-data"><input name="name" placeholder="Name" value="${user.name||''}"><input name="email" type="email" placeholder="Email" value="${user.email||''}"><input name="subject" value="Support chat" placeholder="Subject"><textarea name="message" rows="3" placeholder="Type or paste text here"></textarea><input name="file" type="file" accept="image/*,.pdf,.doc,.docx,.txt"><input name="language" type="hidden" value="${language}"><button class="btn teal" type="submit">Send</button><div id="chat-status" class="small"></div></form></div>`;
  document.body.appendChild(div);
  const panel=div.querySelector('.chat-panel'),thread=div.querySelector('#chat-thread');
  const chatAccessToken=()=>localStorage.getItem('worldnet_chat_access_token')||'';
  const chatHeaders=(json=false)=>{const headers={};if(json)headers['Content-Type']='application/json';if(getToken())headers.Authorization=`Bearer ${getToken()}`;if(chatAccessToken())headers['X-Chat-Access-Token']=chatAccessToken();return headers;};
  const toggle=()=>{div.classList.toggle('open');if(div.classList.contains('open'))refreshChat();};
  div.querySelector('#support-chat-launcher').addEventListener('click',toggle); div.querySelector('.chat-close').addEventListener('click',()=>div.classList.remove('open'));
  div.querySelector('.chat-scroll-up').addEventListener('click',()=>thread.scrollBy({top:-140,behavior:'smooth'})); div.querySelector('.chat-scroll-down').addEventListener('click',()=>thread.scrollBy({top:140,behavior:'smooth'}));
  div.querySelectorAll('[data-chat-status]').forEach(btn=>btn.addEventListener('click',async()=>{const id=localStorage.getItem('worldnet_chat_ticket');if(!id)return;try{await apiJson(`${API_BASE}/support/chat/${id}/status`,{method:'PATCH',headers:chatHeaders(true),body:JSON.stringify({status:btn.dataset.chatStatus})});await refreshChat();}catch(e){$('#chat-status').textContent=e.message;}}));
  let timer; async function refreshChat(){const id=localStorage.getItem('worldnet_chat_ticket');if(!id)return;try{const item=await apiJson(`${API_BASE}/support/chat/${id}`,{headers:chatHeaders()});const tokenQuery=chatAccessToken()?`?accessToken=${encodeURIComponent(chatAccessToken())}`:'';thread.innerHTML=`<div class="chat-bubble user"><b>You</b><p>${escapeHtml(item.localMessage||item.message||'')}</p>${(item.attachments||[]).map(x=>`<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="${API_BASE.replace(/\/api$/,'')}${x.url}${tokenQuery}">📎 ${escapeHtml(x.filename)}</a>`).join('')}</div>${(item.replies||[]).map(r=>`<div class="chat-bubble staff"><b>${escapeHtml(r.repliedBy||'Support')}</b><p>${escapeHtml(r.localBody||r.body)}</p>${r.localBody&&r.localBody!==r.body?`<small>English: ${escapeHtml(r.body)}</small>`:''}</div>`).join('')}<small>Status: ${item.status}</small>`;thread.scrollTop=thread.scrollHeight;}catch(error){if(error.message.includes('Secure conversation access')){$('#chat-status').textContent='Start a new secure chat to continue.';clearInterval(timer);}}}
  div.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const out=$('#chat-status'),fd=new FormData(e.target);out.textContent='Sending…';try{const headers={};if(getToken())headers.Authorization=`Bearer ${getToken()}`;const res=await fetch(`${API_BASE}/support/chat`,{method:'POST',headers,body:fd});const data=await res.json();if(!res.ok)throw new Error(data.message||'Chat failed');localStorage.setItem('worldnet_chat_ticket',data.ticketId);localStorage.setItem('worldnet_chat_access_token',data.accessToken||'');out.textContent='Delivered to support staff.';e.target.querySelector('textarea').value='';e.target.querySelector('input[type=file]').value='';await refreshChat();clearInterval(timer);timer=setInterval(()=>{if(div.classList.contains('open'))refreshChat()},12000);}catch(err){out.textContent=err.message;}});
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
    if(error?.name==='AbortError') throw new Error('The backend request timed out. Confirm the backend API is running and try again.');
    throw new Error('Unable to reach the World Net Hosting backend. Confirm the backend API is running and the frontend API URL is correct.');
  }finally{clearTimeout(timeout);}
  const contentType=String(res.headers.get('content-type')||'').toLowerCase();
  const text=await res.text();
  let data={};
  if(text && contentType.includes('application/json')){
    try{data=JSON.parse(text);}catch{throw new Error(`The backend returned invalid JSON for ${new URL(url,location.href).pathname} (HTTP ${res.status}).`);}
  }else if(text){
    const safeMessage=text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    throw new Error(safeMessage && safeMessage.length<180 ? safeMessage : `The API endpoint returned a non-JSON response (HTTP ${res.status}).`);
  }
  if(!res.ok) throw new Error(data.message || `Request failed (HTTP ${res.status})`); return data;
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
  const userPages=['dashboard.html','dashboard-cart.html','dashboard-register-domain.html','dashboard-dns-manager.html','dashboard-business-email.html','dashboard-transfer-domain.html','dashboard-receive-domain.html','dashboard-support.html','dashboard-wallet.html','wallet-deposit.html','wallet-withdraw.html','wallet-send.html','wallet-transfer.html','wallet-receive.html','wallet-convert.html','dns-manager.html','domain-transfer.html','domain-receive.html'];
  if(userPages.includes(page)){
    if(!getToken()){ sessionStorage.setItem('worldnet_return_to',page); location.replace('signin.html'); return false; }
    if(localStorage.getItem('worldnet_pin_ok')!=='yes' && page!=='pin.html'){ sessionStorage.setItem('worldnet_return_to',page); location.replace('pin.html'); return false; }
  }
  return true;
}

function ensureCompletePublicNavigation(){
  if(document.body.classList.contains('dashboard-body')||document.documentElement.classList.contains('dashboard-embedded')) return;
  if(document.querySelector('.top-nav')) return;
  const header=document.createElement('header');
  header.className='top-nav';
  header.innerHTML=`<div class="nav-left"><a class="logo" href="index.html"><img class="site-logo" src="images/logo1.jpeg" alt="World Net Hosting logo"><span class="site-brand-name">WNH</span></a><button type="button" class="nav-toggle" aria-label="Open navigation menu" aria-expanded="false"><span class="nav-toggle-icon">☰</span><span class="nav-toggle-label">Menu</span></button><details class="nav-dropdown"><summary class="nav-item">Domains <span>⌄</span></summary><div class="dropdown-menu"><a href="domains.html">Domain Search</a><a href="dns-manager.html">DNS Manager</a><a href="domain-transfer.html">Transfer Domain</a><a href="domain-receive.html">Receive Domain</a><a href="reviews.html">Reviews</a><a href="deals.html">Deals</a><a href="security.html">Security</a><a href="terms.html">Terms and Conditions</a><a href="policy.html">Policy</a><a href="help.html">Help</a></div></details><a href="email.html" class="nav-item">Email</a><a href="pricing.html" class="nav-item">Pricing</a><a href="about.html" class="nav-item">About</a><a href="contact.html" class="nav-item">Contact</a><a href="ai-builder.html" class="nav-item">AI Builder</a></div><div class="nav-right"><a href="signin.html" class="nav-item nav-auth-link">Joinfree</a><a href="cart.html" class="cart" aria-label="Cart" data-count="0">🛒</a></div>`;
  document.body.prepend(header);
}

function setupResponsiveNavigation(){
  const header=document.querySelector('.top-nav');
  if(!header||header.dataset.mobileNavigationReady==='true') return;
  header.dataset.mobileNavigationReady='true';
  // Normalize older public-page headers where the brand and menu button were
  // incorrectly placed inside .nav-left. On mobile .nav-left is collapsed, which
  // also hid the brand and menu trigger. Keep only the navigation links collapsible.
  const navLeft=Array.from(header.children).find((node)=>node.classList?.contains('nav-left'));
  let logo=header.querySelector('.logo');
  let toggle=header.querySelector('.nav-toggle');
  if(navLeft && logo && logo.parentElement===navLeft) header.insertBefore(logo,navLeft);
  if(navLeft && toggle && toggle.parentElement===navLeft) header.insertBefore(toggle,navLeft);
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


function setupWalletAccessLinks(){
  document.querySelectorAll('[data-wallet-access]').forEach(link=>{
    link.addEventListener('click',event=>{
      const target=(link.getAttribute('href')||'dashboard-wallet.html').split('/').pop();
      if(!getToken()){
        event.preventDefault();
        sessionStorage.setItem('worldnet_return_to',target);
        localStorage.setItem('worldnet_return_to',target);
        location.href=`signin.html?next=${encodeURIComponent(target)}`;
      }
    });
  });
}
function secureDashboardLinks(){
  document.querySelectorAll('a[href="dashboard.html"],a[data-dashboard-link]').forEach(a=>a.addEventListener('click',e=>{
    if(!getToken()){ e.preventDefault(); sessionStorage.setItem('worldnet_return_to','dashboard.html'); location.href='signin.html'; }
    else if(localStorage.getItem('worldnet_pin_ok')!=='yes'){ e.preventDefault(); sessionStorage.setItem('worldnet_return_to','dashboard.html'); location.href='pin.html'; }
  }));
}
async function validatePublicSession(){
  const token=getToken();
  if(!token) return null;
  try{
    const response=await fetch(`${API_BASE}/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok) throw new Error('invalid session');
    const data=await readApiResponse(response);
    if(!data?.user) throw new Error('invalid session');
    localStorage.setItem('worldnet_user',JSON.stringify(data.user));
    return data.user;
  }catch(_){
    ['worldnet_token','worldnet_user','worldnet_pin_mode','worldnet_pin_ok'].forEach(k=>localStorage.removeItem(k));
    return null;
  }
}
function injectAccountActions(){
  // Public navigation is intentionally static. Public pages must always show
  // Joinfree and must never expose Dashboard or Logout controls.
  if(document.body.classList.contains('dashboard-body')) return;
  const nav=document.querySelector('.nav-right');
  if(!nav) return;
  nav.querySelectorAll('[data-user-logout],.public-logout-link,[data-dashboard-link]').forEach(el=>el.remove());
  let auth=nav.querySelector('.nav-auth-link');
  if(!auth){
    auth=document.createElement('a');
    auth.className='nav-item nav-auth-link';
    const cart=nav.querySelector('.cart');
    nav.insertBefore(auth,cart||null);
  }
  auth.textContent='Joinfree';
  auth.href='signin.html';
  auth.removeAttribute('data-dashboard-link');
}
window.openDnsManager=openDnsManager; window.addDnsRecord=addDnsRecord; window.deleteDnsRecord=deleteDnsRecord; window.updateNameservers=updateNameservers;
window.logoutUser=logoutUser; window.addToCart=addToCart; window.payWithPaystack=payWithPaystack; window.createOrder=createOrder;


async function setupAiBuilder(){
  const form=document.getElementById('ai-builder-form');
  if(!form) return;
  const output=document.getElementById('ai-builder-output');
  const status=document.getElementById('ai-builder-status');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const aiToken=getToken();
    if(!aiToken){ const target=location.pathname.split('/').pop()+location.search; sessionStorage.setItem('worldnet_return_to',target); localStorage.setItem('worldnet_return_to',target); location.href=`signin.html?next=${encodeURIComponent(target)}`; return; }
    setFormBusy(form,true,'Generating…');
    if(status){status.style.display='block';status.textContent='Building your website starter…';}
    try{
      const payload=Object.fromEntries(new FormData(form));
      const response=await fetch(`${API_BASE}/ai-builder/generate`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${aiToken||''}`},body:JSON.stringify(payload)});
      const data=await readApiResponse(response); if(!response.ok) throw new Error(data.message||`Request failed (${response.status})`);
      const files=data.website?.files||{};
      if(output){output.innerHTML='';Object.entries(files).forEach(([name,content])=>{const card=document.createElement('section');card.className='ai-file-card';const head=document.createElement('div');head.className='ai-file-head';const label=document.createElement('strong');label.textContent=name;const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Copy';button.addEventListener('click',async()=>{await navigator.clipboard.writeText(content);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1400)});head.append(label,button);const area=document.createElement('textarea');area.readOnly=true;area.value=content;card.append(head,area);output.appendChild(card);});}
      if(status) status.textContent=data.message||'Website starter generated successfully.';
    }catch(error){if(status)status.textContent=error.message||'AI Builder request failed.';}
    finally{setFormBusy(form,false);}
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  // Bind security-critical forms before any network request or optional page setup.
  // This prevents credentials from falling back to a browser GET submission when
  // currency, translator, dashboard, or other initialization fails or is slow.
  $('#signup-form')?.addEventListener('submit', handleSignup);
  $('#login-form')?.addEventListener('submit', handleLogin);
  document.querySelectorAll('[data-recovery]').forEach(f=>f.addEventListener('submit',handleRecovery));
  $('#account-security-form')?.addEventListener('submit',handleAccountUpdate);
  document.querySelectorAll('form[data-contact]').forEach(f=>f.addEventListener('submit',submitContact));
  setupPasswordToggles();

  const requestedNext = new URLSearchParams(location.search).get('next');
  if (requestedNext && /^[a-z0-9._-]+\.html$/i.test(requestedNext)) sessionStorage.setItem('worldnet_return_to', requestedNext);
  if(!protectPrivatePages()) return;

  try { ensureCompletePublicNavigation(); setupResponsiveNavigation(); setupWalletAccessLinks(); } catch (_) {}
  try { secureDashboardLinks(); updatePublicAuthNavigation(); ensureDashboardCartButton(); setupDashboardMobileMenu(); setupDashboardSidebar(); } catch (_) {}
  try { await initCurrency(); injectCurrencySelector(); refreshCurrencyUI(); } catch (error) { console.warn('Currency initialization skipped:', error); }
  try { updateCartCount(); loadPlans(); renderCart(); loadDashboard(); setupPinPage(); setupSupportChat(); } catch (error) { console.warn('Optional page initialization skipped:', error); }
  try { setupLiveDomainSearch(); setupAiBuilder(); } catch (error) { console.warn('Service initialization skipped:', error); }
  document.querySelectorAll('[data-domain-search]').forEach(b=>b.addEventListener('click',(event)=>{ event.preventDefault(); clearTimeout(domainLiveTimer); searchDomains('', b, {live:false}); }));
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

function updatePublicAuthNavigation(){ if(document.body.classList.contains('dashboard-body')) return; injectAccountActions(); }

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

window.initializeWalletDeposit=initializeWalletDeposit;window.domainAction=domainAction;




async function loadWalletBanking(){
 const host=document.getElementById('wallet-banking-content'); if(!host||!getToken())return;
 const token=getToken();
 try{const summary=await apiJson(`${API_BASE}/wallet/banking/summary`,{headers:{Authorization:`Bearer ${token}`}});const fee=Number(summary.platformFeePercent||0);const dva=summary.dedicatedAccount||{};
 host.innerHTML=`<div><p class="app-kicker">Banking tools</p><h2>Transfer, Receive & Convert</h2><p class="small">${fee}% platform fee applies to transfers, received funds and conversions.</p></div>
 <div class="banking-forms">
 <form id="bank-transfer-form" class="banking-form"><h3>Transfer to Bank</h3><input name="amount" type="number" min="100" step="0.01" placeholder="Amount" required><select name="currency"><option>NGN</option><option>GHS</option><option>KES</option><option>ZAR</option></select><select name="bankCode" id="bank-transfer-bank" required><option value="">Select bank</option></select><input name="accountNumber" inputmode="numeric" placeholder="Account number" required><input name="accountName" placeholder="Resolved account name" readonly required><textarea name="reason" rows="2" placeholder="Transfer reason"></textarea><span class="fee-inline">Fee: ${fee}% · Paystack Transfer must be enabled.</span><button class="btn teal">Transfer</button><div class="small form-status"></div></form>
 <div class="banking-form"><h3>Receive from Any Bank</h3><div class="receive-account">${dva.active?`<b>${escapeHtml(dva.bankName||'Paystack Bank')}</b><br>${escapeHtml(dva.accountNumber||'')}<br>${escapeHtml(dva.accountName||'')}`:'Create a dedicated Paystack bank account for this wallet.'}</div><button id="create-receive-account" class="btn teal" type="button">Create Receive Account</button><div id="receive-account-status" class="small"></div></div>
 <form id="wallet-convert-form" class="banking-form"><h3>Convert Banking Balance</h3><input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required><select name="fromCurrency">${['NGN','USD','GHS','KES','ZAR','GBP','EUR'].map(x=>`<option>${x}</option>`).join('')}</select><select name="toCurrency">${['USD','NGN','GHS','KES','ZAR','GBP','EUR'].map(x=>`<option>${x}</option>`).join('')}</select><span class="fee-inline">Live exchange rate · ${fee}% fee for customer and reseller accounts.</span><button class="btn teal">Convert</button><div class="small form-status"></div></form></div>
 <div class="banking-history"><h3>Recent banking activity</h3>${(summary.operations||[]).length?(summary.operations||[]).map(o=>`<div class="banking-history-item"><span><b>${escapeHtml(String(o.type||'').replaceAll('_',' '))}</b><br>${new Date(o.createdAt).toLocaleString()}</span><span>${money(o.amount,o.currency)}<br><span class="badge">${escapeHtml(o.status)}</span></span></div>`).join(''):'<p class="small">No banking activity yet.</p>'}</div>`;
 await populateTransferBanks('NGN');
 const tf=document.getElementById('bank-transfer-form');tf?.querySelector('[name=currency]')?.addEventListener('change',e=>populateTransferBanks(e.target.value));tf?.querySelector('[name=accountNumber]')?.addEventListener('blur',resolveTransferAccount);
 tf?.addEventListener('submit',submitBankTransfer);document.getElementById('wallet-convert-form')?.addEventListener('submit',submitWalletConvert);document.getElementById('create-receive-account')?.addEventListener('click',createReceiveAccount);
 }catch(e){host.innerHTML=`<div class="notice">${escapeHtml(e.message)}</div>`;}
}
async function populateTransferBanks(currency){const select=document.getElementById('bank-transfer-bank');if(!select)return;select.innerHTML='<option value="">Loading banks…</option>';try{const banks=await apiJson(`${API_BASE}/wallet/banking/banks?currency=${encodeURIComponent(currency)}`,{headers:{Authorization:`Bearer ${getToken()}`}});select.innerHTML='<option value="">Select bank</option>'+banks.map(b=>`<option value="${escapeHtml(b.code)}">${escapeHtml(b.name)}</option>`).join('');}catch(e){select.innerHTML='<option value="">Banks unavailable</option>';}}
async function resolveTransferAccount(e){const form=e.target.form,number=e.target.value,bankCode=form.bankCode.value;if(!number||!bankCode)return;const out=form.querySelector('.form-status');out.textContent='Verifying account…';try{const d=await apiJson(`${API_BASE}/wallet/banking/resolve-account?accountNumber=${encodeURIComponent(number)}&bankCode=${encodeURIComponent(bankCode)}`,{headers:{Authorization:`Bearer ${getToken()}`}});form.accountName.value=d.account_name||'';out.textContent='Account verified.';}catch(x){form.accountName.value='';out.textContent=x.message;}}
async function submitBankTransfer(e){e.preventDefault();const form=e.currentTarget,out=form.querySelector('.form-status'),button=form.querySelector('button');button.disabled=true;out.textContent='Submitting transfer…';try{const body=Object.fromEntries(new FormData(form));body.amount=Number(body.amount);const d=await apiJson(`${API_BASE}/wallet/banking/transfer`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify(body)});out.textContent=d.message;form.reset();await loadWalletBanking();}catch(x){out.textContent=x.message;}finally{button.disabled=false;}}
async function createReceiveAccount(){const out=document.getElementById('receive-account-status');out.textContent='Creating secure bank account…';try{const d=await apiJson(`${API_BASE}/wallet/banking/receive-account`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:'{}'});out.textContent=d.message;await loadWalletBanking();}catch(x){out.textContent=x.message;}}
async function submitWalletConvert(e){e.preventDefault();const form=e.currentTarget,out=form.querySelector('.form-status'),button=form.querySelector('button');button.disabled=true;out.textContent='Converting…';try{const body=Object.fromEntries(new FormData(form));body.amount=Number(body.amount);const d=await apiJson(`${API_BASE}/wallet/banking/convert`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify(body)});out.textContent=d.message;await loadWalletBanking();}catch(x){out.textContent=x.message;}finally{button.disabled=false;}}
document.addEventListener('DOMContentLoaded',loadWalletBanking);

document.addEventListener('DOMContentLoaded',()=>{ensureCompletePublicNavigation();setupResponsiveNavigation();setupWalletAccessLinks();updatePublicAuthNavigation();updateCartCount();});
window.addEventListener('pageshow',event=>{if(event.persisted){try{loadDashboard();loadWalletBanking();updatePublicAuthNavigation();updateCartCount();}catch(_){}}});
