(function configureWorldNetHosting(){
  const productionApi='https://world-net-hosting-backend.onrender.com/api';
  const productionFrontend='https://world-net-hosting-frontend.onrender.com';
  const isLocalHost=['localhost','127.0.0.1'].includes(window.location.hostname);
  const cleanUrl=value=>String(value||'').trim().replace(/\/$/,'');
  const isLocalUrl=value=>/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(cleanUrl(value));

  const savedLocalApi=cleanUrl(localStorage.getItem('WORLDNET_LOCAL_API'));
  const savedApi=cleanUrl(localStorage.getItem('WORLDNET_API'));
  const localApi=!isLocalUrl(savedLocalApi)&&savedLocalApi
    ? savedLocalApi
    : (savedLocalApi||'http://localhost:10000/api');

  // Production safety: deployed pages always use the live HTTPS backend.
  // Browser storage, old localhost values, and development overrides are ignored outside localhost.
  const api=isLocalHost
    ? (savedApi||localApi)
    : productionApi;

  if(!isLocalHost){
    localStorage.removeItem('WORLDNET_API');
    localStorage.removeItem('WORLDNET_LOCAL_API');
  }

  window.WORLDNET_CONFIG=Object.freeze({
    API_BASE_URL:api,
    PRODUCTION_API_BASE_URL:productionApi,
    FRONTEND_URL:isLocalHost?window.location.origin:productionFrontend,
    PAYSTACK_PUBLIC_KEY:'',
    IS_PRODUCTION:!isLocalHost
  });
  window.WORLDNET_API_BASE=api;
  window.PAYSTACK_PUBLIC_KEY='';
})();
