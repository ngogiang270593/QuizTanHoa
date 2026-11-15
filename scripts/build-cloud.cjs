'use strict';
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
if(process.env.VITE_API_BASE_URL)throw new Error('Cloud deployment uses same-origin /api. Unset VITE_API_BASE_URL.');
const envFile=path.join(root,'frontend','.env.web.local');
if(fs.existsSync(envFile)&&/^\s*VITE_API_BASE_URL\s*=/m.test(fs.readFileSync(envFile,'utf8')))throw new Error('Remove VITE_API_BASE_URL from frontend/.env.web.local for Cloudflare deployment.');
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run this script with npm run build:cloud.');
for(const args of [['--prefix','frontend','run','build:web'],['--prefix','cloud','run','build']]){
  const result=spawnSync(process.execPath,[npmCli,...args],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
const out=path.join(root,'frontend','dist-web');
fs.writeFileSync(path.join(out,'_routes.json'),JSON.stringify({version:1,include:['/api','/api/*'],exclude:[]}));
fs.writeFileSync(path.join(out,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\n`);
for(const file of fs.readdirSync(out,{recursive:true}))if(/firebase-adminsdk|\.json\.key|pages-secrets|admin-login/i.test(file))throw new Error('Sensitive file in build output.');
console.log('Cloud build ready: frontend/dist-web (same-origin API).');
