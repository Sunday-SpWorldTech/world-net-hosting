(function configureWorldNetHosting(){
  const cleanUrl=value=>String(value||'').trim().replace(/\/+$/,'');
  const configured=cleanUrl(window.WORLDNET_CONFIG?.API_BASE_URL||window.WORLDNET_API_BASE||window.WORLDNET_API_BASE_URL||'');
  const host=String(window.location.hostname||'').toLowerCase();
  const isLocalHost=['localhost','127.0.0.1'].includes(host);
  const localBackend=`${window.location.protocol}//${window.location.hostname}:10000/api`;
  const knownRenderBackend='https://world-net-hosting-backend.onrender.com/api';
  const sameOriginApi=`${window.location.origin}/api`;
  const inferredRenderBackend=host.includes('-frontend.onrender.com')
    ? `${window.location.protocol}//${host.replace('-frontend.onrender.com','-backend.onrender.com')}/api`
    : '';
  const candidates=[configured,isLocalHost?localBackend:'',inferredRenderBackend,knownRenderBackend,sameOriginApi]
    .map(cleanUrl).filter((value,index,array)=>value&&array.indexOf(value)===index);
  const api=candidates[0]||sameOriginApi;
  window.WORLDNET_CONFIG=Object.freeze({
    API_BASE_URL:api,
    API_CANDIDATES:Object.freeze(candidates),
    FRONTEND_URL:window.location.origin,
    PAYSTACK_PUBLIC_KEY:window.PAYSTACK_PUBLIC_KEY||'',
    DEFAULT_DISPLAY_CURRENCY:'USD',
    IS_PRODUCTION:!isLocalHost
  });
  window.WORLDNET_API_BASE=api;
  window.WORLDNET_API_BASE_URL=api;
  window.WORLDNET_API_CANDIDATES=Object.freeze(candidates);
})();
