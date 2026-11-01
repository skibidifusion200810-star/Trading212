'use strict';
// GOLDX browser-only mode. This is a LOCAL SIMULATION, not a global account system.
// Every browser has its own users, trading history, price stream and chat.
window.GOLDX_DEMO = (() => {
  const KEY = 'goldx_browser_game_v3';
  const SESSION_KEY = 'goldx_browser_player_v3';
  const round = n => Math.round(Number(n)*100)/100;
  const clone = x => JSON.parse(JSON.stringify(x));
  const fail = msg => { throw new Error(msg); };
  const now = () => Math.floor(Date.now()/1000);
  const stored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const saveSession = id => { if(id==null)localStorage.removeItem(SESSION_KEY);else localStorage.setItem(SESSION_KEY,String(id)); };
  const getSession = () => stored(SESSION_KEY);
  const gaussian = () => Math.sqrt(-2*Math.log(Math.max(Math.random(),.000001)))*Math.cos(2*Math.PI*Math.random());
  const randomSalt = () => {
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  };
  async function digest(password,salt) {
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({
      name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:90000,hash:'SHA-256'
    },key,256);
    return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function bootstrap() {
    const start=Math.floor(now()/60)*60;
    const candles=[];let price=3330;
    for(let i=360;i>0;i--){
      const open=price;
      price=round(Math.max(500,price+(Math.random()-.49)*2.7));
      candles.push({time:start-i*60,open,high:round(Math.max(open,price)+Math.random()*1),
        low:round(Math.min(open,price)-Math.random()),close:price});
    }
    return {users:[],market:{price,candles,ticks:[],lastTick:now()-1,trend:0,volatility:.6},
      messages:[],nextId:1};
  }
  function read(){
    const value=stored(KEY);
    if(value){try{const db=JSON.parse(value);if(db && Array.isArray(db.users)&&db.market)return db;}catch{}}
    const db=bootstrap();write(db);return db;
  }
  function write(db) {localStorage.setItem(KEY,JSON.stringify(db));}
  function getUser(db) {return db.users.find(u=>String(u.id)===getSession())||null;}
  function positionPnl(p,price) {
    const exit=price+(p.side==='buy'?-.12:.12);
    return round((exit-Number(p.entry_price))*Number(p.quantity)*(p.side==='buy'?1:-1));
  }
  function margin(p) {return Number(p.entry_price)*Number(p.quantity)/20;}
  function freeMargin(u,price) {
    const open=u.positions.filter(x=>x.status==='open');
    return Number(u.balance)+open.reduce((sum,p)=>sum+positionPnl(p,price),0)-open.reduce((sum,p)=>sum+margin(p),0);
  }
  function transaction(u,amount,kind,description){
    u.transactions.unshift({id:Date.now()+Math.random(),amount:round(amount),kind,description,created_at:new Date().toISOString()});
    u.transactions=u.transactions.slice(0,200);
  }
  function account(u,db){
    const closed=u.positions.filter(p=>p.status==='closed'),open=u.positions.filter(p=>p.status==='open');
    const profit=round(closed.reduce((sum,p)=>sum+Number(p.pnl),0));
    const unrealized=round(open.reduce((sum,p)=>sum+positionPnl(p,db.market.price),0));
    return {id:u.id,username:u.username,created_at:u.created_at,balance:round(u.balance),affiliate_code:u.affiliate_code||null,
      referrals:u.referrals,profit,trades:closed.length,wins:closed.filter(p=>p.pnl>0).length,
      equity:round(u.balance+unrealized),unrealized,freeMargin:round(Math.max(0,freeMargin(u,db.market.price)))};
  }
  const validQty=q=>typeof q==='number'&&Number.isFinite(q)&&q>=.001&&q<=5&&Math.abs(q*1000-Math.round(q*1000))<1e-7;
  function riskCheck(side,sl,tp,price) {
    if([sl,tp].some(v=>v!==null&&(!Number.isFinite(v)||v<100||v>100000)))fail('Ungültiger Stop Loss oder Take Profit.');
    if(side==='buy'&&((sl!==null&&sl>=price)||(tp!==null&&tp<=price)))fail('Bei BUY muss SL unter und TP über dem Einstieg liegen.');
    if(side==='sell'&&((sl!==null&&sl<=price)||(tp!==null&&tp>=price)))fail('Bei SELL muss SL über und TP unter dem Einstieg liegen.');
  }
  function openPosition(db,u,side,quantity,sl,tp) {
    const entry=round(db.market.price+(side==='buy'?.12:-.12));
    if(entry*quantity/20>freeMargin(u,db.market.price))
      fail('Nicht genügend freie Margin. Reduziere die Positionsgröße.');
    const p={id:db.nextId++,user_id:u.id,side,quantity,entry_price:entry,sl,tp,
      status:'open',exit_price:null,pnl:null,close_reason:null,opened_at:new Date().toISOString(),closed_at:null};
    u.positions.unshift(p);
    return p;
  }
  function closePosition(db,u,p,reason) {
    if(p.status!=='open')fail('Die Position ist bereits geschlossen.');
    const exit=round(db.market.price+(p.side==='buy'?-.12:.12));
    const raw=round((exit-Number(p.entry_price))*Number(p.quantity)*(p.side==='buy'?1:-1));
    const actual=Math.max(-u.balance,raw);
    u.balance=round(u.balance+actual);
    Object.assign(p,{status:'closed',exit_price:exit,pnl:actual,close_reason:reason,closed_at:new Date().toISOString()});
    transaction(u,actual,'trade',reason+' #'+p.id);
    return actual;
  }
  function tick() {
    const db=read();
    const current=now(),m=db.market;
    if(m.lastTick>=current)return {price:m.price,time:current,changed:false};
    if(Math.random()<.035){m.trend=(Math.random()-.5)*.2;m.volatility=.3+Math.random()*1.2;}
    const jump=Math.random()<.007?gaussian()*1.5:0;
    m.price=round(Math.max(300,m.price+gaussian()*m.volatility*.28+m.trend+jump));
    m.lastTick=current;
    m.ticks.push({ts:current,price:m.price});m.ticks=m.ticks.slice(-2000);
    const minute=Math.floor(current/60)*60;
    const c=m.candles[m.candles.length-1];
    if(!c||minute>c.time) m.candles.push({time:minute,open:c?c.close:m.price,high:m.price,low:m.price,close:m.price});
    else {c.high=Math.max(c.high,m.price);c.low=Math.min(c.low,m.price);c.close=m.price;}
    m.candles=m.candles.slice(-450);
    let changed=false;
    for(const u of db.users){
      for(const p of u.positions.filter(p=>p.status==='open')){
        const exit=m.price+(p.side==='buy'?-.12:.12);
        const sl=p.sl!==null&&(p.side==='buy'?exit<=p.sl:exit>=p.sl);
        const tp=p.tp!==null&&(p.side==='buy'?exit>=p.tp:exit<=p.tp);
        if(sl||tp){closePosition(db,u,p,sl?'stop_loss':'take_profit');changed=true;}
      }
      for(const o of u.orders.filter(o=>o.status==='pending')){
        const hit=o.order_type==='limit'?
          (o.side==='buy'?m.price<=o.target_price:m.price>=o.target_price):
          (o.side==='buy'?m.price>=o.target_price:m.price<=o.target_price);
        if(!hit)continue;
        try{openPosition(db,u,o.side,o.quantity,o.sl,o.tp);o.status='filled';}
        catch{ o.status='rejected'; }
        changed=true;
      }
    }
    write(db);
    return {price:m.price,time:current,changed};
  }
  function candles(db,seconds) {
    let rows;
    if(seconds<60){
      const groups=new Map();
      for(const t of db.market.ticks){
        const ts=Math.floor(t.ts/seconds)*seconds;
        const price=t.price;
        if(!groups.has(ts))groups.set(ts,{time:ts,open:price,high:price,low:price,close:price});
        else {const c=groups.get(ts);c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;}
      }
      rows=[...groups.values()];
    } else if(seconds===60)rows=db.market.candles;
    else {
      const groups=new Map();
      for(const c of db.market.candles){
        const ts=Math.floor(c.time/seconds)*seconds;
        if(!groups.has(ts))groups.set(ts,{time:ts,open:c.open,high:c.high,low:c.low,close:c.close});
        else {const a=groups.get(ts);a.high=Math.max(a.high,c.high);a.low=Math.min(a.low,c.low);a.close=c.close;}
      }
      rows=[...groups.values()];
    }
    return clone(rows.slice(-280));
  }
  function leaderboard(db,mode){
    const entries=db.users.map(u=>({username:u.username,balance:round(u.balance),
      profit:round(u.positions.filter(p=>p.status==='closed').reduce((s,p)=>s+p.pnl,0)),
      wins:u.positions.filter(p=>p.status==='closed'&&p.pnl>0).length,
      trades:u.positions.filter(p=>p.status==='closed').length}));
    return entries.sort((a,b)=>mode==='balance'?b.balance-a.balance:mode==='wins'?b.wins-a.wins||b.profit-a.profit:b.profit-a.profit).slice(0,50);
  }
  async function request(path,opts={}) {
    const method=(opts.method||'GET').toUpperCase(),body=opts.body?JSON.parse(opts.body):{};
    const url=new URL(path,location.origin),route=url.pathname,db=read();
    if(route==='/api/market')return {symbol:'XAU/USD',simulated:true,price:db.market.price,spread:.24,leverage:20,online:1};
    if(route==='/api/market/candles'){
      const intervals={'1s':1,'5s':5,'15s':15,'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1D':86400};
      return candles(db,intervals[url.searchParams.get('interval')]||60);
    }
    if(route==='/api/health')return {ok:true,mode:'browser'};
    if(route==='/api/auth/register'&&method==='POST'){
      const name=String(body.username||'').trim(),pwd=body.password;
      if(!/^[a-zA-Z0-9_]{3,20}$/.test(name))fail('Benutzername: 3–20 Buchstaben, Zahlen oder _.');
      if(typeof pwd!=='string'||pwd.length<8||pwd.length>72)fail('Passwort muss zwischen 8 und 72 Zeichen lang sein.');
      if(db.users.some(u=>u.username.toLowerCase()===name.toLowerCase()))fail('Dieser Benutzername existiert auf deinem Gerät bereits.');
      const code=String(body.affiliateCode||'').trim().toUpperCase();
      const owner=code?db.users.find(u=>u.affiliate_code===code):null;
      if(code&&!owner)fail('Affiliate-Code auf diesem Gerät nicht gefunden. Im Offline-Modus funktionieren Codes nur lokal.');
      const salt=randomSalt(),hash=await digest(pwd,salt);
      const u={id:db.nextId++,username:name,salt,hash,balance:owner?3500:1500,created_at:new Date().toISOString(),
        affiliate_code:null,referrals:0,positions:[],orders:[],transactions:[]};
      transaction(u,1500,'start','Startguthaben');
      if(owner){transaction(u,2000,'affiliate_welcome','Affiliate-Anmeldebonus');owner.balance+=1000;
        owner.referrals++;transaction(owner,1000,'affiliate_referral','Affiliate-Empfehlung');}
      db.users.push(u);write(db);saveSession(u.id);
      return {user:account(u,db),token:'local-demo'};
    }
    if(route==='/api/auth/login'&&method==='POST'){
      const name=String(body.username||'').trim(),pwd=body.password;
      const u=db.users.find(u=>u.username.toLowerCase()===name.toLowerCase());
      if(!u||typeof pwd!=='string'||(await digest(pwd,u.salt))!==u.hash)fail('Benutzername oder Passwort falsch.');
      saveSession(u.id);return {user:account(u,db),token:'local-demo'};
    }
    if(route==='/api/auth/logout'&&method==='POST'){saveSession(null);return {ok:true};}
    const u=getUser(db);
    if(!u)fail('Bitte melde dich zuerst an.');
    if(route==='/api/me')return {user:account(u,db),positions:clone(u.positions.slice(0,120)),
      orders:clone(u.orders.filter(o=>o.status==='pending').slice(0,80)),transactions:clone(u.transactions.slice(0,50))};
    if(route==='/api/leaderboard')return leaderboard(db,url.searchParams.get('mode'));
    if(route==='/api/chat')return clone(db.messages.slice(-60));
    if(route==='/api/affiliate'&&method==='POST'){
      const code=String(body.code||'').trim().toUpperCase();
      if(!/^[A-Z0-9_]{3,20}$/.test(code))fail('Code: 3–20 Zeichen (A–Z, 0–9, _).');
      if(u.affiliate_code)fail('Du besitzt bereits einen Affiliate-Code.');
      if(db.users.some(x=>x.affiliate_code===code))fail('Dieser Code ist bereits vergeben.');
      u.affiliate_code=code;write(db);return {code};
    }
    if(route==='/api/orders'&&method==='POST'){
      const side=body.side,qty=body.quantity,type=body.type||'market';
      if(!['buy','sell'].includes(side)||!validQty(qty))fail('Ungültige Richtung oder Menge (0,001–5 oz).');
      if(!['market','limit','stop'].includes(type))fail('Ungültiger Ordertyp.');
      const sl=body.sl==null?null:Number(body.sl),tp=body.tp==null?null:Number(body.tp);
      const target=body.targetPrice;
      if(type!=='market'&&(!Number.isFinite(target)||target<100||target>100000))fail('Ungültiger Zielkurs.');
      riskCheck(side,sl,tp,type==='market'?db.market.price:target);
      if(type==='limit'&&((side==='buy'&&target>=db.market.price)||(side==='sell'&&target<=db.market.price)))fail('Limit liegt auf der falschen Marktseite.');
      if(type==='stop'&&((side==='buy'&&target<=db.market.price)||(side==='sell'&&target>=db.market.price)))fail('Stop Order liegt auf der falschen Marktseite.');
      let order;
      if(type==='market')order=openPosition(db,u,side,qty,sl,tp);
      else {order={id:db.nextId++,user_id:u.id,side,order_type:type,target_price:target,
        quantity:qty,sl,tp,status:'pending',created_at:new Date().toISOString()};u.orders.unshift(order);}
      write(db);return {order:clone(order)};
    }
    let match=route.match(/^\/api\/orders\/(\d+)\/cancel$/);
    if(match&&method==='POST'){
      const o=u.orders.find(o=>String(o.id)===match[1]&&o.status==='pending');
      if(!o)fail('Pending Order nicht gefunden.');
      o.status='cancelled';write(db);return {ok:true};
    }
    match=route.match(/^\/api\/positions\/(\d+)\/close$/);
    if(match&&method==='POST'){
      const p=u.positions.find(p=>String(p.id)===match[1]&&p.status==='open');
      if(!p)fail('Offene Position nicht gefunden.');
      const pnl=closePosition(db,u,p,'manual');write(db);return {ok:true,pnl};
    }
    match=route.match(/^\/api\/positions\/(\d+)$/);
    if(match&&method==='PATCH'){
      const p=u.positions.find(p=>String(p.id)===match[1]&&p.status==='open');
      if(!p)fail('Offene Position nicht gefunden.');
      const sl=body.sl==null?null:Number(body.sl),tp=body.tp==null?null:Number(body.tp);
      riskCheck(p.side,sl,tp,db.market.price);p.sl=sl;p.tp=tp;write(db);return {position:clone(p)};
    }
    fail('Funktion in der Browser-Demo nicht verfügbar.');
  }
  function sendChat(body) {
    const db=read(),u=getUser(db);
    if(!u)return {error:'Bitte zuerst anmelden.'};
    if(typeof body!=='string'||!body.trim()||body.trim().length>240)return {error:'Nachricht muss 1–240 Zeichen lang sein.'};
    const last=db.messages[db.messages.length-1];
    if(last&&last.username===u.username&&Date.now()-new Date(last.created_at).getTime()<1200)
      return {error:'Bitte nicht spammen.'};
    const message={id:db.nextId++,username:u.username,body:body.trim(),created_at:new Date().toISOString()};
    db.messages.push(message);db.messages=db.messages.slice(-80);write(db);
    return {ok:true,message};
  }
  return {request,tick,sendChat,session:()=>Boolean(getSession()),logout:()=>saveSession(null)};
})();
