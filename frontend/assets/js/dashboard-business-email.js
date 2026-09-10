"use strict";
(()=>{
 const token=localStorage.getItem('worldnet_token')||'';if(!token){location.href='reseller-signin.html';return;}
 const base=String(window.WORLDNET_CONFIG?.API_BASE_URL||window.WORLDNET_API_BASE_URL||'/api').replace(/\/$/,'');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const mount=document.getElementById('business-email-plans'),status=document.getElementById('business-email-status');
 const setStatus=(m,bad=false)=>{status.style.display='block';status.className=`notice${bad?' error':''}`;status.textContent=m;};
 async function load(){try{const r=await fetch(`${base}/email/plans`,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`}});const plans=await r.json();if(!r.ok)throw new Error(plans.message||'Email plans unavailable.');mount.innerHTML=(plans||[]).map(p=>`<article class="card"><span class="eyebrow">Business email</span><h3>${esc(p.name)}</h3><div class="price">$${Number(p.price||0).toFixed(2)} <small>/ month</small></div><p>${esc(p.description||'Professional mailbox service.')}</p><p class="small">Base $${Number(p.basePrice||0).toFixed(2)} + WNH markup $${Number(p.markupUSD||0).toFixed(2)}</p><button class="btn teal" type="button" data-email-plan='${encodeURIComponent(JSON.stringify(p))}'>Add to Cart</button></article>`).join('')||'<div class="notice">No email plans available.</div>';}catch(e){setStatus(e.message,true);}}
 mount.addEventListener('click',e=>{const b=e.target.closest('[data-email-plan]');if(!b)return;try{const p=JSON.parse(decodeURIComponent(b.dataset.emailPlan));const cart=JSON.parse(localStorage.getItem('worldnet_cart')||'[]');cart.push({type:'email',code:p.code,name:p.name,price:Number(p.price||0),usdPrice:Number(p.price||0),billing:p.billing||'monthly'});localStorage.setItem('worldnet_cart',JSON.stringify(cart));setStatus(`${p.name} added to cart.`);}catch{setStatus('Could not add this plan to cart.',true);}});
 load();
})();
