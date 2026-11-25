import { Pool, Client } from 'pg';
import mysql from 'mysql2/promise';
import { randomUUID, randomBytes, scryptSync, createHmac, timingSafeEqual } from 'node:crypto';

const metaPool = process.env.DATABASE_URL ? new Pool({connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 7000, connectionTimeoutMillis: 6000}) : null;
const MAX_SQL = 18000;
const MAX_SQLITE_B64 = 1150000; // about 860 KB raw; within Vercel function request limits
const ENGINE_SET = new Set(['sqlite','postgres','mysql']);

function json(res,status,body) { res.status(status).setHeader('Content-Type','application/json; charset=utf-8').end(JSON.stringify(body)); }
function ensure(value,message,status=400) {if(!value){const e=new Error(message);e.httpStatus=status;throw e;}}
function secret() {ensure((process.env.SESSION_SECRET||'').length >= 32,'SESSION_SECRET nav konfigurēts.',503);return process.env.SESSION_SECRET;}
function sign(payload) {const value=Buffer.from(JSON.stringify(payload)).toString('base64url');return value+'.'+createHmac('sha256',secret()).update(value).digest('base64url');}
function verify(value) {
  if(!value || typeof value!=='string') return null;
  const [payload,signature]=value.split('.'); if(!payload||!signature) return null;
  const correct=createHmac('sha256',secret()).update(payload).digest('base64url');
  if(!secureEquals(signature,correct)) return null;
  try {const obj=JSON.parse(Buffer.from(payload,'base64url').toString());return obj.exp>Date.now()?obj:null;} catch {return null;}
}
function secureEquals(a,b) {const aa=Buffer.from(String(a));const bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function passwordHash(password,salt=randomBytes(16).toString('hex')) {return salt+':'+scryptSync(password,salt,64).toString('hex');}
function checkPassword(password,hash) {const [salt,expected]=String(hash||'').split(':');if(!salt||!expected||!(/^[a-f0-9]{128}$/.test(expected)))return false;return secureEquals(scryptSync(password,salt,64).toString('hex'),expected);}
function cookie(req) {const raw=req.headers.cookie||''; const m=raw.match(/(?:^|;\s*)sql_lab_session=([^;]+)/);return verify(m?.[1]);}
function setCookie(req,res,value,maxAge=86400*7) {
  const secure = req.headers['x-forwarded-proto']==='https' || (req.headers.host||'').includes('vercel.app');
  res.setHeader('Set-Cookie',`sql_lab_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`);
}
function clearCookie(req,res){setCookie(req,res,'',0);}
function fail(message,status=400){const e=new Error(message);e.httpStatus=status;throw e;}
const db = async (query,args=[])=> {ensure(metaPool,'DATABASE_URL nav konfigurēts.',503);return metaPool.query(query,args);};
function bodyOf(req){const b=req.body;if(typeof b==='object'&&b!==null)return b; if(typeof b==='string'){ensure(b.length<1800000,'Pārāk liels pieprasījums.',413);try{return JSON.parse(b);}catch{return {};}}return {};}
function clientIp(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();}
async function checkThrottle(req) {
  const hash=createHmac('sha256',secret()).update('ip:'+clientIp(req)).digest('hex');
  const {rows}=await db("SELECT count(*)::int AS n FROM lab_login_attempts WHERE ip_hash=$1 AND created_at > NOW()-INTERVAL '15 minutes' AND NOT success",[hash]);
  ensure(rows[0].n < 12,'Pārāk daudz mēģinājumu. Pamēģini vēlāk.',429);
  return hash;
}
async function logLogin(hash,success){await db('INSERT INTO lab_login_attempts(ip_hash,success) VALUES ($1,$2)',[hash,success]);}
async function auth(req,teacher=false){
  const session=cookie(req); ensure(session, 'Lūdzu, pieslēdzies.',401);
  if(teacher) {ensure(session.role==='teacher','Nepietiek tiesību.',403);return session;}
  ensure(session.role==='student' && /^[0-9a-f-]{36}$/.test(session.uid||''),'Nepietiek tiesību.',403);
  const {rows}=await db('SELECT id,username,display_name,class_group FROM lab_users WHERE id=$1',[session.uid]);
  ensure(rows.length===1,'Konts nav atrasts.',401);return rows[0];
}
function verifyEngine(engine){ensure(ENGINE_SET.has(engine),'Nepareiza DBVS izvēle.');}
function configured(engine){return engine==='sqlite'?true:engine==='postgres'?Boolean(process.env.PG_LAB_ADMIN_URL):Boolean(process.env.MYSQL_LAB_ADMIN_URL);}
function roleName(uid){return 'lab_'+String(uid).replace(/-/g,'').slice(0,22);}
function personalPwd(uid,engine){return createHmac('sha256',secret()).update(`workspace:${engine}:${uid}`).digest('hex');}
function pgPersonalUrl(uid) {const u=new URL(process.env.PG_LAB_ADMIN_URL);u.username=roleName(uid);u.password=personalPwd(uid,'postgres');return u.toString();}
function mysqlOptions(uid,admin=false) {
  const u=new URL(process.env.MYSQL_LAB_ADMIN_URL);
  return {host:u.hostname,port:Number(u.port||3306), user:admin?decodeURIComponent(u.username):roleName(uid),password:admin?decodeURIComponent(u.password):personalPwd(uid,'mysql'),database:admin?(u.pathname.slice(1)||undefined):roleName(uid),connectTimeout:6500, multipleStatements:false,ssl:process.env.MYSQL_LAB_SSL==='false'?undefined:{rejectUnauthorized:true}};
}
async function provisionPg(uid) {
  ensure(configured('postgres'),'PostgreSQL laboratorija nav pieslēgta.',503);
  const role=roleName(uid),pwd=personalPwd(uid,'postgres');
  const client=new Client({connectionString:process.env.PG_LAB_ADMIN_URL,connectionTimeoutMillis:6500});await client.connect();
  try {
    const found=await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
    if(!found.rowCount) await client.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${pwd}'`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${role}" AUTHORIZATION "${role}"`);
    await client.query(`ALTER ROLE "${role}" SET search_path TO "${role}"`);
    await client.query(`ALTER ROLE "${role}" SET statement_timeout TO '5000ms'`);
    await client.query(`ALTER ROLE "${role}" SET idle_in_transaction_session_timeout TO '5000ms'`);
  } finally {await client.end();}
}
async function provisionMysql(uid) {
  ensure(configured('mysql'),'MySQL laboratorija nav pieslēgta.',503);
  const role=roleName(uid),pwd=personalPwd(uid,'mysql');
  const conn=await mysql.createConnection(mysqlOptions(uid,true));
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${role}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`CREATE USER IF NOT EXISTS '${role}'@'%' IDENTIFIED BY '${pwd}'`);
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW, TRIGGER ON \`${role}\`.* TO '${role}'@'%'`);
  } finally {await conn.end();}
}
async function userWorkspace(uid,engine,create=false) {
  verifyEngine(engine);
  if(create) await db('INSERT INTO lab_workspaces(id,user_id,engine) VALUES($1,$2,$3) ON CONFLICT(user_id,engine) DO NOTHING',[randomUUID(),uid,engine]);
  const result=await db('SELECT engine,provisioned,sqlite_data,draft_sql,updated_at FROM lab_workspaces WHERE user_id=$1 AND engine=$2',[uid,engine]);
  return result.rows[0]||null;
}
async function runPg(uid,query) {
  const c=new Client({connectionString:pgPersonalUrl(uid),connectionTimeoutMillis:5500,query_timeout:7500,statement_timeout:5000});
  await c.connect();
  try {
    const result=await c.query(query);
    const last=Array.isArray(result)?result.at(-1):result;
    const rows=last?.rows||[];
    return {command:last?.command||'',rowCount:last?.rowCount??rows.length,columns:(last?.fields||[]).map(f=>f.name),rows:rows.slice(0,150),truncated:rows.length>150,statements:Array.isArray(result)?result.length:1};
  } finally {await c.end();}
}
async function runMysql(uid,query) {
  const c=await mysql.createConnection(mysqlOptions(uid,false));
  try {
    const [rows,fields]=await c.query({sql:query,timeout:7000});
    if(Array.isArray(rows))return {command:'SELECT',rowCount:rows.length,columns:fields?.map(f=>f.name)||Object.keys(rows[0]||{}),rows:rows.slice(0,150),truncated:rows.length>150,statements:1};
    return {command:'OK',rowCount:rows.affectedRows??0,columns:[],rows:[],statements:1};
  } finally {await c.end();}
}
async function explorePg(uid){
  return (await runPg(uid, "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name LIMIT 100")).rows.map(row=>row.table_name);
}
async function exploreMysql(uid){
  const conn=await mysql.createConnection(mysqlOptions(uid,false));try{const [rows]=await conn.query('SHOW TABLES');return rows.map(row=>Object.values(row)[0]);}finally{await conn.end();}
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const origin=req.headers.origin;
    if(req.method!=='GET'&&origin) {const url=new URL(origin);const host=String(req.headers['x-forwarded-host']||req.headers.host||'');ensure(url.host===host,'Nederīgs pieprasījuma avots.',403);}
    const action=String(req.query?.action||new URL(req.url,'https://example.test').searchParams.get('action')||'health');
    if(action==='health')return json(res,200,{ok:true,app:'SQL Lab',storage:Boolean(metaPool),postgres:configured('postgres'),mysql:configured('mysql'),sqlite:true});
    if(action==='signup'&&req.method==='POST') {
      const b=bodyOf(req);const ip=await checkThrottle(req);
      const username=String(b.username||'').trim().toLowerCase();const display=String(b.displayName||'').trim();const group=String(b.classGroup||'').trim();const pass=String(b.password||'');
      ensure(/^[a-z0-9._-]{3,30}$/.test(username),'Lietotājvārds: 3–30 simboli (a-z, 0-9, ., _, -).');
      ensure(username!==String(process.env.ADMIN_USERNAME||'skolotajs').toLowerCase(),'Šis lietotājvārds ir rezervēts.');
      ensure(display.length>=2&&display.length<=90,'Ievadi savu vārdu (2–90 rakstzīmes).');
      ensure(group.length<=40,'Grupas nosaukums pārāk garš.');
      ensure(pass.length>=10&&pass.length<=100,'Parolei jābūt 10–100 simboliem.');
      ensure((process.env.CLASS_CODE||'').length>=6,'CLASS_CODE nav konfigurēts vai ir pārāk īss.',503);
      if(!secureEquals(String(b.classCode||''),process.env.CLASS_CODE)){await logLogin(ip,false);fail('Nepareizs klases kods.',403);}
      const uid=randomUUID();
      try {await db('INSERT INTO lab_users(id,username,display_name,class_group,password_hash) VALUES($1,$2,$3,$4,$5)',[uid,username,display,group,passwordHash(pass)]);}catch(e){if(e.code==='23505')fail('Šis lietotājvārds jau aizņemts.',409);throw e;}
      await logLogin(ip,true);
      setCookie(req,res,sign({role:'student',uid,exp:Date.now()+86400*7*1000}));return json(res,201,{ok:true});
    }
    if(action==='login'&&req.method==='POST') {
      const b=bodyOf(req),ip=await checkThrottle(req);
      const username=String(b.username||'').trim().toLowerCase(),pass=String(b.password||'');
      if(username===String(process.env.ADMIN_USERNAME||'skolotajs').toLowerCase()&&secureEquals(pass,process.env.ADMIN_PASSWORD||'UNCONFIGURED')) {
        ensure((process.env.ADMIN_PASSWORD||'').length>=12,'ADMIN_PASSWORD jābūt vismaz 12 simboliem.',503);
        await logLogin(ip,true);setCookie(req,res,sign({role:'teacher',exp:Date.now()+86400*1000}));return json(res,200,{ok:true,role:'teacher'});
      }
      const {rows}=await db('SELECT id,password_hash FROM lab_users WHERE username=$1',[username]);
      const good=rows.length&&checkPassword(pass,rows[0].password_hash);await logLogin(ip,Boolean(good));
      ensure(good,'Nepareizs lietotājvārds vai parole.',401);
      setCookie(req,res,sign({role:'student',uid:rows[0].id,exp:Date.now()+86400*7*1000}));return json(res,200,{ok:true,role:'student'});
    }
    if(action==='logout'&&req.method==='POST'){clearCookie(req,res);return json(res,200,{ok:true});}
    if(action==='me'&&req.method==='GET'){
      const session=cookie(req);if(!session)return json(res,200,{role:'guest',engines:{sqlite:true,postgres:configured('postgres'),mysql:configured('mysql')}});
      if(session.role==='teacher')return json(res,200,{role:'teacher',engines:{sqlite:true,postgres:configured('postgres'),mysql:configured('mysql')}});
      const u=await auth(req);await db('UPDATE lab_users SET last_seen_at=NOW() WHERE id=$1',[u.id]);
      const {rows}=await db('SELECT engine,provisioned,updated_at FROM lab_workspaces WHERE user_id=$1',[u.id]);
      return json(res,200,{role:'student',user:u,workspaces:rows,engines:{sqlite:true,postgres:configured('postgres'),mysql:configured('mysql')}});
    }
    if(action==='workspace'&&req.method==='GET'){
      const u=await auth(req),engine=String(req.query.engine||'');verifyEngine(engine);
      const workspace=await userWorkspace(u.id,engine,true);
      const {rows:history}=await db('SELECT statement_preview,success,error_summary,created_at FROM lab_queries WHERE user_id=$1 AND engine=$2 ORDER BY created_at DESC LIMIT 12',[u.id,engine]);
      return json(res,200,{workspace,history,configured:configured(engine)});
    }
    if(action==='provision'&&req.method==='POST'){
      const u=await auth(req),engine=String(bodyOf(req).engine||'');verifyEngine(engine);
      ensure(configured(engine),'Šai DBVS vēl nav konfigurēts ārējais serveris.',503);
      const current=await userWorkspace(u.id,engine,true);
      if(!current.provisioned) {
        if(engine==='postgres')await provisionPg(u.id);
        if(engine==='mysql')await provisionMysql(u.id);
        await db('UPDATE lab_workspaces SET provisioned=true,updated_at=NOW() WHERE user_id=$1 AND engine=$2',[u.id,engine]);
      }
      return json(res,200,{ok:true,engine});
    }
    if(action==='save'&&req.method==='POST'){
      const u=await auth(req),b=bodyOf(req),engine=String(b.engine||'');verifyEngine(engine);
      ensure(typeof b.draftSql==='string'&&b.draftSql.length<=MAX_SQL,'SQL teksts pārāk garš.');
      const base64=b.sqliteData;
      if(base64!==undefined) {ensure(engine==='sqlite'&&typeof base64==='string'&&base64.length<=MAX_SQLITE_B64&&/^[a-zA-Z0-9+/=]*$/.test(base64),'SQLite datubāzes fails pārāk liels vai nederīgs.',413);}
      await userWorkspace(u.id,engine,true);
      if(base64!==undefined) await db('UPDATE lab_workspaces SET draft_sql=$1,sqlite_data=$2,updated_at=NOW() WHERE user_id=$3 AND engine=$4',[b.draftSql,base64,u.id,engine]);
      else await db('UPDATE lab_workspaces SET draft_sql=$1,updated_at=NOW() WHERE user_id=$2 AND engine=$3',[b.draftSql,u.id,engine]);
      return json(res,200,{ok:true});
    }
    if(action==='log-sqlite'&&req.method==='POST'){
      const u=await auth(req),b=bodyOf(req);
      ensure(typeof b.statement==='string'&&b.statement.length<=MAX_SQL,'Nederīgs SQL pieprasījums.');
      const {rows:limit}=await db("SELECT count(*)::int AS n FROM lab_queries WHERE user_id=$1 AND created_at>NOW()-INTERVAL '10 minutes'",[u.id]);
      ensure(limit[0].n<150,'Sasniegts drošības limits (150 vaicājumi / 10 min).',429);
      await db('INSERT INTO lab_queries(user_id,engine,statement_preview,success,duration_ms,error_summary) VALUES($1,$2,$3,$4,$5,$6)',[u.id,'sqlite',b.statement.slice(0,1200),Boolean(b.success),Math.max(0,Math.min(90000,Number(b.duration)||0)),String(b.error||'').slice(0,320)]);
      return json(res,200,{ok:true});
    }
    if(action==='run'&&req.method==='POST'){
      const u=await auth(req),b=bodyOf(req),engine=String(b.engine||'');verifyEngine(engine);
      ensure(engine!=='sqlite','SQLite SQL tiek izpildīts droši pārlūkā.');
      ensure(configured(engine),'Šai DBVS nav norādīts serveris.',503);
      const q=String(b.sql||'');ensure(q.trim().length>0&&q.length<=MAX_SQL,'Ievadi SQL vaicājumu (līdz 18 000 rakstzīmēm).');
      const ws=await userWorkspace(u.id,engine,true);ensure(ws.provisioned,'Vispirms izveido savu personīgo datubāzi.',409);
      const {rows:counts}=await db("SELECT count(*)::int AS n FROM lab_queries WHERE user_id=$1 AND created_at>NOW()-INTERVAL '10 minutes'",[u.id]);
      ensure(counts[0].n<150,'Sasniegts drošības limits (150 vaicājumi / 10 min).',429);
      const start=Date.now();let result=null,err=null;
      try{result=engine==='postgres'?await runPg(u.id,q):await runMysql(u.id,q);}
      catch(e){err=e;}
      await db('INSERT INTO lab_queries(user_id,engine,statement_preview,success,duration_ms,error_summary) VALUES($1,$2,$3,$4,$5,$6)',[u.id,engine,q.slice(0,1200),!err,Date.now()-start,String(err?.message||'').slice(0,320)]);
      if(err)fail(`SQL kļūda: ${String(err.message||'Vaicājums neizdevās.').slice(0,250)}`,422);
      return json(res,200,{ok:true,...result,elapsedMs:Date.now()-start});
    }
    if(action==='explore'&&req.method==='GET'){
      const u=await auth(req),engine=String(req.query.engine||'');verifyEngine(engine);
      if(engine==='sqlite')return json(res,200,{tables:[]});
      const ws=await userWorkspace(u.id,engine);ensure(ws?.provisioned,'Vispirms izveido personīgo datubāzi.',409);
      const tables=engine==='postgres'?await explorePg(u.id):await exploreMysql(u.id);
      return json(res,200,{tables});
    }
    if(action==='teacher'&&req.method==='GET'){
      await auth(req,true);
      const {rows}=await db(`SELECT u.id,u.username,u.display_name,u.class_group,u.created_at,u.last_seen_at,
        (SELECT count(*)::int FROM lab_queries q WHERE q.user_id=u.id) AS query_count,
        (SELECT count(*)::int FROM lab_workspaces w WHERE w.user_id=u.id) AS workspace_count
        FROM lab_users u ORDER BY u.last_seen_at DESC NULLS LAST, u.created_at DESC LIMIT 250`);
      return json(res,200,{students:rows});
    }
    if(action==='teacher-student'&&req.method==='GET'){
      await auth(req,true);const uid=String(req.query.uid||'');ensure(/^[0-9a-f-]{36}$/.test(uid),'Nederīgs skolēns.');
      const {rows:students}=await db('SELECT id,username,display_name,class_group,created_at FROM lab_users WHERE id=$1',[uid]);ensure(students.length,'Skolēns nav atrasts.',404);
      const {rows:workspaces}=await db('SELECT engine,provisioned,draft_sql,updated_at FROM lab_workspaces WHERE user_id=$1 ORDER BY engine',[uid]);
      const {rows:logs}=await db('SELECT engine,statement_preview,success,duration_ms,error_summary,created_at FROM lab_queries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 80',[uid]);
      return json(res,200,{student:students[0],workspaces,logs});
    }
    return json(res,404,{error:'Darbība nav atrasta.'});
  } catch(err){
    if(!err.httpStatus)console.error('[SQLLab API]',err);
    return json(res,err.httpStatus||500,{error:err.httpStatus?err.message:'Servera kļūda. Pārbaudi datubāzes konfigurāciju un servera žurnālus.'});
  }
}
