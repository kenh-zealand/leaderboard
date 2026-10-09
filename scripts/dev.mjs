import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker/index.mjs';
import {SQLiteD1} from './sqlite-d1.mjs';
const port=Number(process.env.PORT||8000),dir=process.env.DATA_DIR||'data';
await fs.mkdir(dir,{recursive:true});
const env={DB:new SQLiteD1(path.join(dir,'worker.sqlite3')),ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,BASE_URL:process.env.BASE_URL||'http://localhost:'+port,
 ASSETS:{async fetch(req){const url=new URL(req.url),name=url.pathname==='/'?'index.html':url.pathname.slice(1);try{return new Response(await fs.readFile(path.join('static',name)),{headers:{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8'}});}catch{return new Response('Not found',{status:404});}}}};
const server=http.createServer(async(req,res)=>{
 try{const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const request=new Request(env.BASE_URL+req.url,{method:req.method,headers:req.headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})});
  const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Server error');}
});
server.listen(port,'127.0.0.1',()=>console.log('Beta preview: '+env.BASE_URL));
function close(){server.close(()=>{env.DB.close();process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
