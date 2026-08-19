(function configureWorldNetHosting(){
  const cleanUrl=value=>String(value||'').trim().replace(/world-net-hosting-backtend\.vercel\.app/gi,'world-net-hosting-backend.vercel.app').replace(/\/+$/,'');
  const configured=cleanUrl(window.WORLDNET_CONFIG?.API_BASE_URL||window.WORLDNET_API_BASE||window.WORLDNET_API_BASE_URL||'');
  const canonicalBackend='https://world-net-hosting-backend.vercel.app/api';
  const protocol=String(window.location.protocol||'').toLowerCase();
  const host=String(window.location.hostname||'').toLowerCase();
  const isFile=protocol==='file:';
  const isLocalHost=['localhost','127.0.0.1'].includes(host);
  const localBackend=isLocalHost?'http://localhost:3000/api':'';
  const sameOriginApi=(!isFile&&window.location.origin&&window.location.origin!=='null')?`${window.location.origin}/api`:'';
  const candidates=[configured,localBackend,canonicalBackend,sameOriginApi]
    .map(cleanUrl)
    .filter((value,index,array)=>value&&array.indexOf(value)===index);
  const api=candidates[0]||canonicalBackend;
  window.WORLDNET_CONFIG=Object.freeze({
    API_BASE_URL:api,
    API_CANDIDATES:Object.freeze(candidates),
    FRONTEND_URL:isFile?'':window.location.origin,
    DEFAULT_DISPLAY_CURRENCY:'USD',
    IS_PRODUCTION:!isLocalHost&&!isFile
  });
  window.WORLDNET_API_BASE=api;
  window.WORLDNET_API_BASE_URL=api;
  window.WORLDNET_API_CANDIDATES=Object.freeze(candidates);
})();
