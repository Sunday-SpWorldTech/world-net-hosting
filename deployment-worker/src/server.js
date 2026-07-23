require('dotenv').config();
const express=require('express'); const helmet=require('helmet'); const crypto=require('crypto'); const fs=require('fs/promises'); const path=require('path'); const {spawn}=require('child_process');
const app=express(); app.use(helmet()); app.use(express.json({limit:'2mb'}));
const PORT=Number(process.env.PORT||11000); const ROOT=process.env.WORKSPACE_ROOT||'/var/lib/world-net-hosting/builds';
function authorized(req){const token=process.env.DEPLOYMENT_WORKER_TOKEN||process.env.WORKER_TOKEN||'';if(!token)return false;const a=Buffer.from(String(req.headers.authorization||''));const b=Buffer.from(`Bearer ${token}`);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function run(cmd,args,opts={}){return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{...opts,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error(`${cmd} failed (${code}): ${err.slice(-4000)}`)));});}
function safeId(v){return String(v).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)}
app.get('/health',(req,res)=>res.json({ok:true,dockerRequired:true}));
app.post('/v1/deployments',async(req,res)=>{if(!authorized(req))return res.sendStatus(401);const d=req.body||{};if(!d.projectId||!d.deploymentId||!d.repository?.cloneUrl)return res.status(400).json({message:'Incomplete deployment payload'});res.status(202).json({accepted:true,deploymentId:d.deploymentId});setImmediate(async()=>{const id=safeId(d.deploymentId);const dir=path.join(ROOT,id);try{await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});
// Private repository cloning requires a short-lived installation token supplied by a hardened broker in production.
if(d.repository.private)throw new Error('Private repository cloning requires the worker token-broker endpoint to be configured.');
await run('git',['clone','--depth','1','--branch',d.branch||'main',d.repository.cloneUrl,dir]);
const work=path.join(dir,String(d.rootDirectory||'').replace(/^\/+|\.\./g,''));
const image=`wnh-${safeId(d.projectId)}:${id}`;const dockerfile=path.join(work,'Dockerfile');
try{await fs.access(dockerfile)}catch{const content=d.serviceType==='static'?`FROM nginx:alpine\nCOPY ${d.publishDirectory||'dist'} /usr/share/nginx/html\n`:`FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD [\"npm\",\"start\"]\n`;await fs.writeFile(dockerfile,content)}
await run('docker',['build','-t',image,'.'],{cwd:work});
await run('docker',['rm','-f',`wnh-${safeId(d.projectId)}`]).catch(()=>{});
const envArgs=Object.entries(d.environment||{}).flatMap(([k,v])=>['-e',`${k}=${v}`]);
await run('docker',['run','-d','--name',`wnh-${safeId(d.projectId)}`,'--restart','unless-stopped','--memory','512m','--cpus','0.5',...envArgs,image]);
console.log(`Deployment ${id} is live; connect reverse-proxy automation for ${d.platformSubdomain}.`)
}catch(e){console.error(`Deployment ${id} failed:`,e.message)}})});
app.listen(PORT,()=>console.log(`World Net Hosting worker listening on ${PORT}`));
