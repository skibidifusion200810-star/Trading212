'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { Server } = require('socket.io');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Configure a PostgreSQL database.');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
const PAGE_ORIGINS = [...new Set(['https://skibidifusion200810-star.github.io', ...(process.env.FRONTEND_ORIGIN || '').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean)])];
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Only these public origins may call the backend from browsers.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && PAGE_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(!origin || PAGE_ORIGINS.includes(origin) ? 204 : 403);
  next();
});
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", 'ws:', 'wss:'],
  fontSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: null
} } }));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: PAGE_ORIGINS, methods: ['GET', 'POST'] }, transports: ['websocket', 'polling'] });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // Isolate GOLDX tables when a Render Postgres instance is shared with other apps.
  options: '-c search_path=goldx,public' });
const SECRET = process.env.SESSION_SECRET;
const LEVERAGE = 20;
const SPREAD = 0.24;
const $ = (v) => Math.round(Number(v) * 100) / 100;
let price = 3330.48, marketTrend = 0, volatility = 0.55, tickCount = 0;
let running = false;
const recentChat = new Map();

async function query(sql, params = []) { return pool.query(sql, params); }
function validateUser(name) { return typeof name === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(name); }
function validateEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 180; }
function fail(res, status, msg) { return res.status(status).json({ error: msg }); }
function signed(req) {
  try {
    const header = req.get('authorization');
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : req.cookies.goldx_session;
    return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  }
  catch { return null; }
}
function auth(req, res, next) {
  const u = signed(req);
  if (!u?.id) return fail(res, 401, 'Bitte melde dich zuerst an.');
  req.user = u; next();
}
function cookie(res, id) {
  const token = jwt.sign({ id }, SECRET, { expiresIn: '7d' });
  res.cookie('goldx_session', token,
    { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400000 });
  return token;
}
function errorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent) return next(err);
  return fail(res, 500, 'Serverfehler. Bitte versuche es erneut.');
}
const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-7',
  legacyHeaders: false, message: { error: 'Zu viele Versuche. Bitte später erneut versuchen.' } });
function validNumber(n, min, max) { return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max; }
function validateRisk(side, sl, tp, ref) {
  if (sl !== null && !validNumber(sl, 100, 100000)) return 'Ungültiger Stop Loss.';
  if (tp !== null && !validNumber(tp, 100, 100000)) return 'Ungültiger Take Profit.';
  if (side === 'buy' && ((sl !== null && sl >= ref) || (tp !== null && tp <= ref))) return 'Bei BUY muss SL unter und TP über dem Kurs liegen.';
  if (side === 'sell' && ((sl !== null && sl <= ref) || (tp !== null && tp >= ref))) return 'Bei SELL muss SL über und TP unter dem Kurs liegen.';
  return null;
}
function entryPrice(side) { return $(price + (side === 'buy' ? SPREAD / 2 : -SPREAD / 2)); }
function exitPrice(side) { return $(price + (side === 'buy' ? -SPREAD / 2 : SPREAD / 2)); }
function pnlFor(position, currentPrice = price) {
  const exit = currentPrice + (position.side === 'buy' ? -SPREAD / 2 : SPREAD / 2);
  return $((exit - Number(position.entry_price)) * Number(position.quantity) * (position.side === 'buy' ? 1 : -1));
}
async function ledger(client, user, amount, kind, description) {
  await client.query('INSERT INTO wallet_transactions (user_id,amount,kind,description) VALUES ($1,$2,$3,$4)', [user, amount, kind, description]);
}
async function init() {
  await query('CREATE SCHEMA IF NOT EXISTS goldx');
  await query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY, username VARCHAR(20) NOT NULL, email VARCHAR(180) NOT NULL,
    password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci ON users (lower(email))');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS users_name_ci ON users (lower(username))');
  await query(`CREATE TABLE IF NOT EXISTS wallets (
    user_id BIGINT PRIMARY KEY REFERENCES users(id), balance NUMERIC(16,2) NOT NULL DEFAULT 1500 CHECK (balance >= 0))`);
  await query(`CREATE TABLE IF NOT EXISTS affiliate_codes (
    user_id BIGINT PRIMARY KEY REFERENCES users(id), code VARCHAR(20) NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS referrals (
    referred_user_id BIGINT PRIMARY KEY REFERENCES users(id), referrer_user_id BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(), CHECK (referred_user_id <> referrer_user_id))`);
  await query(`CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
    amount NUMERIC(16,2) NOT NULL, kind VARCHAR(30) NOT NULL, description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS positions (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), side VARCHAR(4) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL, entry_price NUMERIC(12,2) NOT NULL,
    sl NUMERIC(12,2), tp NUMERIC(12,2),
    status VARCHAR(12) NOT NULL DEFAULT 'open', exit_price NUMERIC(12,2), pnl NUMERIC(16,2),
    close_reason VARCHAR(24), opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ)`);
  await query('CREATE INDEX IF NOT EXISTS positions_user_status ON positions(user_id,status)');
  await query(`CREATE TABLE IF NOT EXISTS pending_orders (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), side VARCHAR(4) NOT NULL,
    order_type VARCHAR(5) NOT NULL, target_price NUMERIC(12,2) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL, sl NUMERIC(12,2), tp NUMERIC(12,2),
    status VARCHAR(12) NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now())`);
  await query('CREATE INDEX IF NOT EXISTS orders_status_idx ON pending_orders(status)');
  await query(`CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
    body VARCHAR(240) NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS market_state (
    id INT PRIMARY KEY CHECK(id=1), price NUMERIC(12,2) NOT NULL, updated_at BIGINT NOT NULL)`);
  await query(`CREATE TABLE IF NOT EXISTS market_ticks (
    ts BIGINT PRIMARY KEY, price NUMERIC(12,2) NOT NULL)`);
  await query(`CREATE TABLE IF NOT EXISTS market_candles (
    ts BIGINT PRIMARY KEY, open NUMERIC(12,2) NOT NULL, high NUMERIC(12,2) NOT NULL,
    low NUMERIC(12,2) NOT NULL, close NUMERIC(12,2) NOT NULL)`);
  const state = await query('SELECT * FROM market_state WHERE id=1');
  if (state.rows.length) { price = Number(state.rows[0].price); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const start = Math.floor(Date.now() / 60000) * 60 - 240 * 60;
    let p = 3310;
    for (let i=0; i<240; i++) {
      const o = p;
      p = $(Math.max(100, p + (Math.random() - .48) * 5));
      const h = $(Math.max(o, p) + Math.random() * 1.8);
      const l = $(Math.min(o, p) - Math.random() * 1.8);
      await client.query('INSERT INTO market_candles(ts,open,high,low,close) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [start+i*60,o,h,l,p]);
    }
    price = p;
    await client.query('INSERT INTO market_state(id,price,updated_at) VALUES(1,$1,$2) ON CONFLICT DO NOTHING', [price,Math.floor(Date.now()/1000)]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
async function account(id) {
  const result = await query(`SELECT u.id,u.username,u.email,u.created_at,w.balance,
    (SELECT code FROM affiliate_codes WHERE user_id=u.id) affiliate_code,
    (SELECT count(*) FROM referrals WHERE referrer_user_id=u.id) referrals,
    (SELECT count(*) FROM positions WHERE user_id=u.id AND status='closed') trades,
    (SELECT count(*) FROM positions WHERE user_id=u.id AND status='closed' AND pnl>0) wins,
    (SELECT COALESCE(SUM(pnl),0) FROM positions WHERE user_id=u.id AND status='closed') profit
    FROM users u JOIN wallets w ON u.id=w.user_id WHERE u.id=$1`, [id]);
  if (!result.rows[0]) return null;
  const a = result.rows[0];
  const positions = await query('SELECT * FROM positions WHERE user_id=$1 AND status=$2 ORDER BY opened_at DESC', [id,'open']);
  const unrealized = positions.rows.reduce((sum, p) => sum + pnlFor(p), 0);
  const usedMargin = positions.rows.reduce((sum, p) => sum + Number(p.entry_price)*Number(p.quantity)/LEVERAGE, 0);
  return { ...a, balance:Number(a.balance), profit:Number(a.profit), referrals:Number(a.referrals),
    trades:Number(a.trades), wins:Number(a.wins), equity: $(Number(a.balance)+unrealized),
    unrealized:$(unrealized), usedMargin:$(usedMargin), freeMargin:$(Math.max(0,Number(a.balance)+unrealized-usedMargin)) };
}
async function portfolio(id) {
  const [p, o, t] = await Promise.all([
    query('SELECT * FROM positions WHERE user_id=$1 ORDER BY id DESC LIMIT 120', [id]),
    query("SELECT * FROM pending_orders WHERE user_id=$1 AND status='pending' ORDER BY id DESC LIMIT 80", [id]),
    query('SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [id])
  ]);
  return { positions:p.rows, orders:o.rows, transactions:t.rows };
}
async function notifyUser(id, data) {
  io.to('user:' + id).emit('account:change', data);
}
function broadcastNotice(id, message, type='info') {
  io.to('user:' + id).emit('notice', { message, type, time:Date.now() });
}
app.get('/api/health', async (req,res) => {
  try { await query('SELECT 1'); res.json({ok:true}); }
  catch { res.status(503).json({ok:false}); }
});
app.get('/api/market', (req,res) => res.json({ symbol:'XAU/USD', simulated:true, price, spread:SPREAD, leverage:LEVERAGE, online:io.engine.clientsCount }));
app.get('/api/market/candles', async (req,res,next) => {
  try {
    const intervals={ '1s':1,'5s':5,'15s':15,'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1D':86400 };
    const secs = intervals[req.query.interval] || 60;
    let result;
    if(secs<60) {
      result=await query(`SELECT FLOOR(ts/$1)::bigint*$1 AS time,
       (ARRAY_AGG(price ORDER BY ts))[1] AS open, MAX(price) AS high, MIN(price) AS low,
       (ARRAY_AGG(price ORDER BY ts DESC))[1] AS close
       FROM (SELECT ts,price FROM market_ticks ORDER BY ts DESC LIMIT 14000) x
       GROUP BY FLOOR(ts/$1) ORDER BY time DESC LIMIT 280`,[secs]);
    } else {
      result=await query(`SELECT FLOOR(ts/$1)::bigint*$1 AS time,
       (ARRAY_AGG(open ORDER BY ts))[1] AS open, MAX(high) AS high, MIN(low) AS low,
       (ARRAY_AGG(close ORDER BY ts DESC))[1] AS close
       FROM (SELECT * FROM market_candles ORDER BY ts DESC LIMIT 15000) x
       GROUP BY FLOOR(ts/$1) ORDER BY time DESC LIMIT 280`,[secs]);
    }
    res.json(result.rows.reverse().map(r=>({time:Number(r.time),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close)})));
  }catch(e){next(e);}
});
app.get('/api/leaderboard', async (req,res,next)=>{
  try {
    const mode=['balance','profit','wins'].includes(req.query.mode) ? req.query.mode : 'profit';
    const order = mode==='balance' ? 'balance DESC' : mode==='wins' ? 'wins DESC, profit DESC' : 'profit DESC';
    const r=await query(`SELECT u.username, w.balance::float8 AS balance,
      COALESCE(SUM(p.pnl) FILTER(WHERE p.status='closed'),0)::float8 AS profit,
      COUNT(p.id) FILTER(WHERE p.status='closed')::int AS trades,
      COUNT(p.id) FILTER(WHERE p.status='closed' AND p.pnl>0)::int AS wins
      FROM users u JOIN wallets w ON w.user_id=u.id
      LEFT JOIN positions p ON p.user_id=u.id GROUP BY u.id,w.balance ORDER BY ${order},u.id ASC LIMIT 50`);
    res.json(r.rows);
  } catch(e){next(e);}
});
app.get('/api/chat', async(req,res,next)=>{
  try {
    const r=await query('SELECT m.id,m.body,m.created_at,u.username FROM chat_messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 60');
    res.json(r.rows.reverse());
  }catch(e){next(e);}
});
app.post('/api/auth/register',authLimiter, async(req,res,next)=>{
  const { username, email, password, affiliateCode } = req.body || {};
  if(!validateUser(username)) return fail(res,400,'Benutzername: 3–20 Buchstaben, Zahlen oder _.');
  if(!validateEmail(email)) return fail(res,400,'Ungültige E-Mail-Adresse.');
  if(typeof password!=='string'||password.length<8||password.length>72) return fail(res,400,'Passwort muss 8 bis 72 Zeichen lang sein.');
  if(affiliateCode && (typeof affiliateCode!=='string'||!/^[A-Z0-9_]{3,20}$/.test(affiliateCode.trim().toUpperCase()))) return fail(res,400,'Ungültiger Affiliate-Code.');
  const client=await pool.connect();
  try {
    const hash=await bcrypt.hash(password,12);
    await client.query('BEGIN');
    let referral=null;
    if(affiliateCode) {
      const rr=await client.query('SELECT user_id FROM affiliate_codes WHERE code=$1', [affiliateCode.trim().toUpperCase()]);
      if(!rr.rows.length) {await client.query('ROLLBACK');return fail(res,400,'Affiliate-Code existiert nicht.');}
      referral=rr.rows[0].user_id;
    }
    const u=await client.query('INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id',[username,email.trim().toLowerCase(),hash]);
    const id=u.rows[0].id;
    await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,$2)',[id,referral?3500:1500]);
    await ledger(client,id,1500,'start','Startguthaben');
    if(referral) {
      await client.query('INSERT INTO referrals(referred_user_id,referrer_user_id) VALUES($1,$2)',[id,referral]);
      await client.query('UPDATE wallets SET balance=balance+1000 WHERE user_id=$1',[referral]);
      await ledger(client,id,2000,'affiliate_welcome','Affiliate-Anmeldebonus');
      await ledger(client,referral,1000,'affiliate_referral','Affiliate-Empfehlung');
    }
    await client.query('COMMIT');
    const token=cookie(res,id);
    if(referral) {await notifyUser(referral,{reason:'affiliate'});broadcastNotice(referral,'Affiliate-Bonus erhalten: +1.000 $','success');}
    res.status(201).json({user:await account(id),token});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    if(e.code==='23505') return fail(res,409,'E-Mail-Adresse oder Benutzername bereits vergeben.');
    next(e);
  }finally{client.release();}
});
app.post('/api/auth/login',authLimiter,async(req,res,next)=>{
  try {
    const { email,password }=req.body||{};
    if(typeof email!=='string'||typeof password!=='string')return fail(res,400,'Login-Daten fehlen.');
    const r=await query('SELECT * FROM users WHERE lower(email)=lower($1)',[email.trim()]);
    if(!r.rows.length||!(await bcrypt.compare(password,r.rows[0].password_hash))) return fail(res,401,'E-Mail oder Passwort falsch.');
    const token=cookie(res,r.rows[0].id);res.json({user:await account(r.rows[0].id),token});
  }catch(e){next(e);}
});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('goldx_session',{path:'/'});res.json({ok:true});});
app.get('/api/me',auth,async(req,res,next)=>{
  try {res.json({user:await account(req.user.id),...(await portfolio(req.user.id))});}
  catch(e){next(e);}
});
app.post('/api/affiliate',auth,async(req,res,next)=>{
  try{
    const code=String(req.body?.code||'').trim().toUpperCase();
    if(!/^[A-Z0-9_]{3,20}$/.test(code))return fail(res,400,'Code: 3–20 Zeichen (A–Z, 0–9, _).');
    const r=await query('SELECT code FROM affiliate_codes WHERE user_id=$1',[req.user.id]);
    if(r.rows.length)return fail(res,409,'Du hast bereits einen persönlichen Code.');
    await query('INSERT INTO affiliate_codes(user_id,code) VALUES($1,$2)',[req.user.id,code]);
    res.status(201).json({code});
  }catch(e){if(e.code==='23505')return fail(res,409,'Dieser Code ist bereits vergeben.');next(e);}
});
async function openPosition(client,user,side,quantity,sl,tp) {
  const w=await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',[user]);
  if(!w.rows.length)throw Object.assign(new Error('Konto nicht gefunden.'),{status:404});
  const existing=await client.query("SELECT side,quantity,entry_price FROM positions WHERE user_id=$1 AND status='open'",[user]);
  const unrealized=existing.rows.reduce((s,p)=>s+pnlFor(p),0);
  const margin=existing.rows.reduce((s,p)=>s+Number(p.entry_price)*Number(p.quantity)/LEVERAGE,0);
  const free=Number(w.rows[0].balance)+unrealized-margin;
  const entry=entryPrice(side), required=entry*quantity/LEVERAGE;
  if(required>free||free<=0)throw Object.assign(new Error('Nicht genügend freie Margin. Positionsgröße reduzieren.'),{status:400});
  const result=await client.query('INSERT INTO positions(user_id,side,quantity,entry_price,sl,tp) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [user,side,quantity,entry,sl,tp]);
  return result.rows[0];
}
app.post('/api/orders',auth,async(req,res,next)=>{
  const {side,quantity,type='market',targetPrice}=req.body||{};
  const sl=req.body?.sl==null||req.body.sl===''?null:Number(req.body.sl);
  const tp=req.body?.tp==null||req.body.tp===''?null:Number(req.body.tp);
  if(!['buy','sell'].includes(side)||!validNumber(quantity,.001,5)||!Number.isInteger(quantity*1000)) return fail(res,400,'Ungültige Seite oder Menge (0,001–5 oz).');
  if(!['market','limit','stop'].includes(type))return fail(res,400,'Ungültiger Ordertyp.');
  if(type!=='market'&&!validNumber(targetPrice,100,100000))return fail(res,400,'Ungültiger Zielkurs.');
  const ref=type==='market'?price:targetPrice;
  const riskError=validateRisk(side,sl,tp,ref);
  if(riskError)return fail(res,400,riskError);
  if(type==='limit'&&((side==='buy'&&targetPrice>=price)||(side==='sell'&&targetPrice<=price)))return fail(res,400,'Limit muss auf der passenden Seite des Marktes liegen.');
  if(type==='stop'&&((side==='buy'&&targetPrice<=price)||(side==='sell'&&targetPrice>=price)))return fail(res,400,'Stop-Order muss auf der passenden Seite des Marktes liegen.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let result;
    if(type==='market')result=await openPosition(client,req.user.id,side,quantity,sl,tp);
    else {
      const r=await client.query('INSERT INTO pending_orders(user_id,side,order_type,target_price,quantity,sl,tp) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [req.user.id,side,type,targetPrice,quantity,sl,tp]);result=r.rows[0];
    }
    await client.query('COMMIT');
    await notifyUser(req.user.id,{reason:'order'});
    res.status(201).json({order:result});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.status)return fail(res,e.status,e.message);next(e);}
  finally{client.release();}
});
app.post('/api/orders/:id/cancel',auth,async(req,res,next)=>{
  try{
    const r=await query("UPDATE pending_orders SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id",[req.params.id,req.user.id]);
    if(!r.rowCount)return fail(res,404,'Offene Order nicht gefunden.');
    await notifyUser(req.user.id,{reason:'cancel'});res.json({ok:true});
  }catch(e){next(e);}
});
async function closePosition(client,p,reason) {
  const exit=exitPrice(p.side);
  const w=await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',[p.user_id]);
  if(!w.rows.length)return null;
  const raw=$( (exit-Number(p.entry_price))*Number(p.quantity)*(p.side==='buy'?1:-1) );
  const actual=Math.max(-Number(w.rows[0].balance),raw);
  const done=await client.query("UPDATE positions SET status='closed',exit_price=$1,pnl=$2,close_reason=$3,closed_at=now() WHERE id=$4 AND status='open' RETURNING id",[exit,actual,reason,p.id]);
  if(!done.rowCount)return null;
  await client.query('UPDATE wallets SET balance=balance+$1 WHERE user_id=$2',[actual,p.user_id]);
  await ledger(client,p.user_id,actual,'trade',reason+' #'+p.id);
  return {user:p.user_id,pnl:actual,reason};
}
app.post('/api/positions/:id/close',auth,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query("SELECT * FROM positions WHERE id=$1 AND user_id=$2 AND status='open' FOR UPDATE",[req.params.id,req.user.id]);
    if(!r.rowCount){await client.query('ROLLBACK');return fail(res,404,'Offene Position nicht gefunden.');}
    const result=await closePosition(client,r.rows[0],'manual');
    await client.query('COMMIT');
    await notifyUser(req.user.id,{reason:'close'});
    res.json({ok:true,pnl:result.pnl});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}
  finally{client.release();}
});
app.patch('/api/positions/:id',auth,async(req,res,next)=>{
  try{
    const r=await query("SELECT * FROM positions WHERE id=$1 AND user_id=$2 AND status='open'",[req.params.id,req.user.id]);
    if(!r.rowCount)return fail(res,404,'Position nicht gefunden.');
    const sl=req.body?.sl==null||req.body.sl===''?null:Number(req.body.sl);
    const tp=req.body?.tp==null||req.body.tp===''?null:Number(req.body.tp);
    const issue=validateRisk(r.rows[0].side,sl,tp,price);
    if(issue)return fail(res,400,issue);
    const updated=await query("UPDATE positions SET sl=$1,tp=$2 WHERE id=$3 AND user_id=$4 AND status='open' RETURNING *",
      [sl,tp,req.params.id,req.user.id]);
    if(!updated.rowCount)return fail(res,409,'Position wurde inzwischen geschlossen.');
    await notifyUser(req.user.id,{reason:'risk'});res.json({position:updated.rows[0]});
  }catch(e){next(e);}
});
function gaussian() {
  const u=Math.max(0.00001,Math.random()),v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function nextPrice() {
  tickCount++;
  if(tickCount%48===0) {
    marketTrend=(Math.random()-.5)*.17;
    volatility=.22+Math.random()*.65;
  }
  const shock=Math.random()<.004?gaussian()*1.5:0;
  const change=gaussian()*volatility*.17+marketTrend*.12+shock;
  return $(Math.max(250,price*Math.exp(change/price)));
}
async function tick() {
  if(running)return;
  running=true;
  const client=await pool.connect();
  let notices=[];
  try{
    const now=Math.floor(Date.now()/1000);
    const next=nextPrice();
    await client.query('BEGIN');
    price=next;
    await client.query('UPDATE market_state SET price=$1,updated_at=$2 WHERE id=1',[price,now]);
    await client.query('INSERT INTO market_ticks(ts,price) VALUES($1,$2) ON CONFLICT(ts) DO UPDATE SET price=EXCLUDED.price',[now,price]);
    const minute=Math.floor(now/60)*60;
    await client.query(`INSERT INTO market_candles(ts,open,high,low,close) VALUES($1,$2,$2,$2,$2)
      ON CONFLICT(ts) DO UPDATE SET high=GREATEST(market_candles.high,EXCLUDED.high),
      low=LEAST(market_candles.low,EXCLUDED.low),close=EXCLUDED.close`,[minute,price]);
    const active=await client.query("SELECT * FROM positions WHERE status='open' AND (sl IS NOT NULL OR tp IS NOT NULL) FOR UPDATE SKIP LOCKED");
    for(const p of active.rows) {
      const exit=exitPrice(p.side);
      const hitTP=p.tp!=null&&(p.side==='buy'?exit>=Number(p.tp):exit<=Number(p.tp));
      const hitSL=p.sl!=null&&(p.side==='buy'?exit<=Number(p.sl):exit>=Number(p.sl));
      if(hitTP||hitSL) {
        const d=await closePosition(client,p,hitSL?'stop_loss':'take_profit');
        if(d)notices.push(d);
      }
    }
    const pending=await client.query("SELECT * FROM pending_orders WHERE status='pending' FOR UPDATE SKIP LOCKED");
    for(const p of pending.rows) {
      const target=Number(p.target_price);
      const triggered=p.order_type==='limit'
        ? (p.side==='buy'?price<=target:price>=target)
        : (p.side==='buy'?price>=target:price<=target);
      if(!triggered)continue;
      try{
        await client.query('SAVEPOINT fill_order');
        await openPosition(client,p.user_id,p.side,Number(p.quantity),p.sl==null?null:Number(p.sl),p.tp==null?null:Number(p.tp));
        await client.query("UPDATE pending_orders SET status='filled' WHERE id=$1",[p.id]);
        await client.query('RELEASE SAVEPOINT fill_order');
        notices.push({user:p.user_id,reason:'filled'});
      }catch(e){
        await client.query('ROLLBACK TO SAVEPOINT fill_order');
        await client.query("UPDATE pending_orders SET status='rejected' WHERE id=$1",[p.id]);
        notices.push({user:p.user_id,reason:'rejected'});
      }
    }
    if(tickCount%300===0){
      await client.query('DELETE FROM market_ticks WHERE ts<$1',[now-86400]);
      await client.query('DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL \'30 days\'');
    }
    await client.query('COMMIT');
    io.emit('market:tick',{price,time:now,online:io.engine.clientsCount});
    for(const d of notices) {
      notifyUser(d.user,{reason:d.reason}).catch(console.error);
      if(d.reason==='take_profit'||d.reason==='stop_loss')
        broadcastNotice(d.user,(d.reason==='take_profit'?'Take Profit':'Stop Loss')+' ausgelöst: '+(d.pnl>=0?'+':'')+$(d.pnl)+' $',d.pnl>=0?'success':'danger');
      else if(d.reason==='filled')broadcastNotice(d.user,'Deine Pending Order wurde ausgeführt.','success');
      else if(d.reason==='rejected')broadcastNotice(d.user,'Order wegen zu geringer Margin abgelehnt.','danger');
    }
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Market tick error:',e);}
  finally{client.release();running=false;}
}
io.use(async(socket,next)=>{
  try{
    const parts=Object.fromEntries((socket.handshake.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
    const token=socket.handshake.auth?.token || (parts.goldx_session ? decodeURIComponent(parts.goldx_session) : null);
    if(!token)return next(new Error('Unauthorized'));
    const payload=jwt.verify(token,SECRET,{algorithms:['HS256']});
    const check=await query('SELECT id,username FROM users WHERE id=$1',[payload.id]);
    if(!check.rowCount)return next(new Error('Unauthorized'));
    socket.data.user=check.rows[0];
    next();
  }catch(e){next(new Error('Unauthorized'));}
});
io.on('connection',socket=>{
  const user=socket.data.user;
  socket.join('user:'+user.id);
  socket.emit('market:tick',{price,time:Math.floor(Date.now()/1000),online:io.engine.clientsCount});
  io.emit('online:count',io.engine.clientsCount);
  socket.on('chat:send',async(data,ack)=>{
    const respond=(payload)=>{if(typeof ack==='function')ack(payload);};
    try{
      const body=typeof data?.body==='string'?data.body.trim():'';
      if(body.length<1||body.length>240)return respond({error:'Nachricht muss 1–240 Zeichen haben.'});
      const now=Date.now(),last=recentChat.get(String(user.id))||0;
      if(now-last<1800)return respond({error:'Bitte nicht spammen.'});
      recentChat.set(String(user.id),now);
      const r=await query('INSERT INTO chat_messages(user_id,body) VALUES($1,$2) RETURNING id,created_at',[user.id,body]);
      const item={id:r.rows[0].id,username:user.username,body,created_at:r.rows[0].created_at};
      io.emit('chat:message',item);
      respond({ok:true});
    }catch(e){console.error(e);respond({error:'Chat aktuell nicht verfügbar.'});}
  });
  socket.on('disconnect',()=>io.emit('online:count',io.engine.clientsCount));
});
app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use(errorHandler);
init().then(()=>{
  server.listen(process.env.PORT||3000,'0.0.0.0',()=>{
    console.log('GOLDX online at port '+(process.env.PORT||3000));
    setInterval(tick,1000);
  });
}).catch(e=>{console.error('Startup failed:',e);process.exit(1);});
