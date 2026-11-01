'use strict';
// GitHub Pages uses browser-only GOLDX_DEMO. No external server required.
const DEMO_MODE = Boolean(window.GOLDX_DEMO);
const API_BASE = DEMO_MODE ? '' : String(window.GOLDX_API_BASE_URL || '').trim().replace(/\/+$/, '');
const TOKEN_KEY = 'goldx_session_token';
let sessionToken = (() => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } })();
function saveToken(token) {
  sessionToken = token || '';
  try { if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken); else localStorage.removeItem(TOKEN_KEY); } catch {}
}
function isPages() { return window.location.hostname.endsWith('.github.io'); }
async function loadSocketClient() {
  if (typeof io === 'function') return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = API_BASE + '/socket.io/socket.io.js';
    script.onload = () => typeof io === 'function' ? resolve() : reject(new Error('Socket.IO nicht verfügbar.'));
    script.onerror = () => reject(new Error('Live-Chat-Server ist nicht erreichbar.'));
    document.head.appendChild(script);
  });
}
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const state = { user:null, positions:[], orders:[], transactions:[], candles:[],
  price:3330.48, prevPrice:3330.48, interval:'1m', side:'buy', tab:'positions',
  rank:'profit', socket:null, currentPage:'terminal', viewCount:70, offset:0,
  crosshair:null, dragging:false, dragX:0, dragStart:0 };
const fmt = (n,dec=2) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
const money = (n) => (Number(n)<0?'-$':'$') + fmt(Math.abs(Number(n)||0));
const pclass = (n) => Number(n)>=0?'positive':'negative';
const date = (v) => new Date(v).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const esc = (s) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opts={}) {
  if (DEMO_MODE) return window.GOLDX_DEMO.request(url,opts);
  const res=await fetch(API_BASE+url,{
    credentials:API_BASE?'omit':'same-origin',...opts,
    headers:{...(opts.body?{'Content-Type':'application/json'}:{}),
      ...(sessionToken?{Authorization:'Bearer '+sessionToken}:{}),...(opts.headers||{})}
  });
  let data;
  try{data=await res.json();}catch{throw new Error('Ungültige Serverantwort.');}
  if(!res.ok)throw new Error(data.error||'Ein Fehler ist aufgetreten.');
  return data;
}
function toast(message,type='info'){
  const node=document.createElement('div');node.className='toast '+type;node.textContent=message;
  qs('#toastArea').prepend(node);setTimeout(()=>node.remove(),4600);
}
function setText(sel,s){const node=qs(sel);if(node)node.textContent=s;}
function updateAccountWidgets() {
  if(!state.user)return;
  const u=state.user;
  const unrealized=state.positions.filter(p=>p.status==='open').reduce((sum,p)=>sum+positionPnl(p),0);
  const margin=state.positions.filter(p=>p.status==='open').reduce((sum,p)=>sum+Number(p.entry_price)*Number(p.quantity)/20,0);
  const equity=Number(u.balance)+unrealized;
  const free=Math.max(0,equity-margin);
  setText('#headerBalance',money(u.balance));setText('#statBalance',money(u.balance));
  setText('#statEquity',money(equity));setText('#statPnl',money(unrealized));
  setText('#statFree',money(free));setText('#freeMargin',money(free));
  qs('#statPnl').className=pclass(unrealized);
  setText('#profileBalance',money(u.balance));setText('#profileProfit',money(u.profit));
  qs('#profileProfit').className=pclass(u.profit);
  setText('#profileWinrate',u.trades?fmt(u.wins/u.trades*100,1)+'%':'0%');
  setText('#profileTrades',u.trades);
  const initial=(u.username||'G').charAt(0).toUpperCase();
  setText('#avatarInitial',initial);setText('#profileInitial',initial);
  setText('#profileName',u.username);
  setText('#profileSince','Mitglied seit '+new Date(u.created_at).toLocaleDateString('de-DE'));
  setText('#referralCount',u.referrals||0);setText('#referralEarnings',money(Number(u.referrals||0)*1000));
  const hasCode=Boolean(u.affiliate_code);
  qs('#affiliateCreate').classList.toggle('hidden',hasCode);
  qs('#affiliateExisting').classList.toggle('hidden',!hasCode);
  setText('#myAffiliateCode',u.affiliate_code||'—');
  estimateMargin();
}
function positionPnl(p){
  const exit=state.price+(p.side==='buy'?-.12:.12);
  return Math.round((exit-Number(p.entry_price))*Number(p.quantity)*(p.side==='buy'?1:-1)*100)/100;
}
async function refreshAccount(){
  if(!state.user)return;
  try{
    const data=await api('/api/me');
    state.user=data.user;state.positions=data.positions||[];state.orders=data.orders||[];
    state.transactions=data.transactions||[];
    updateAccountWidgets();renderPositions();renderTransactions();drawChart();
  }catch(e){if(e.message.includes('melde dich'))showAuth();else console.warn(e);}
}
function showAuth(){qs('#authOverlay').classList.remove('hidden');}
function hideAuth(){qs('#authOverlay').classList.add('hidden');}
let authMode='login';
function switchAuth(mode){
  authMode=mode;
  const reg=mode==='register';
  qs('#loginTab').classList.toggle('active',!reg);
  qs('#registerTab').classList.toggle('active',reg);
  qs('#usernameField').classList.remove('hidden');
  qs('#affiliateField').classList.toggle('hidden',!reg);
  setText('#authTitle',reg?'Deine Reise beginnt hier.':'Willkommen zurück.');
  setText('#authSubtitle',reg?'Starte lokal mit $1,500. Mit einem Code eines Kontos auf diesem Gerät $3,500.':'Melde dich mit Benutzername und Passwort an. Kein E-Mail-Konto nötig.');
  setText('#authSubmit',reg?'KOSTENLOS REGISTRIEREN →':'ANMELDEN →');
  qs('#authSwitch').innerHTML=reg?'Schon ein Konto? <button id="switchRegister">Jetzt anmelden</button>':'Neu hier? <button id="switchRegister">Jetzt kostenlos registrieren</button>';
  qs('#switchRegister').onclick=()=>switchAuth(reg?'login':'register');
  qs('#authPassword').autocomplete=reg?'new-password':'current-password';
  setText('#authError','');
}
async function onAuthenticated(user) {
  state.user=user;
  hideAuth();
  updateAccountWidgets();
  try { if (!DEMO_MODE) await loadSocketClient(); connectSocket(); }
  catch (e) { toast(e.message, 'danger'); }
  await refreshAccount();
  await Promise.all([loadCandles(),loadChat(),loadLeaderboard()]);
}
function connectSocket() {
  if (DEMO_MODE) {
    if (state.socket) state.socket.disconnect();
    setText('#onlineCount', '1');setText('#chatOnline', '1');
    const timer=setInterval(()=>{
      const t=window.GOLDX_DEMO.tick();
      receiveTick(t);
      if (t.changed) refreshAccount();
    },1000);
    state.socket={
      connected:true,
      disconnect(){clearInterval(timer);this.connected=false;},
      emit(event,data,ack){
        if(event==='chat:send'){
          const result=window.GOLDX_DEMO.sendChat(data.body);
          if(result.ok)appendChat(result.message,true);
          if(typeof ack==='function')ack(result.ok?{ok:true}:{error:result.error});
        }
      }
    };
    return;
  }
  if(state.socket)state.socket.disconnect();
  if(typeof io!=='function'){toast('Socket-Verbindung nicht geladen.','danger');return;}
  const socket=io(API_BASE || undefined,{transports:['websocket','polling'],reconnection:true,
    auth:{token:sessionToken}});
  state.socket=socket;
  socket.on('market:tick',receiveTick);
  socket.on('online:count',n=>{setText('#onlineCount',n);setText('#chatOnline',n);});
  socket.on('account:change',()=>refreshAccount());
  socket.on('notice',d=>toast(d.message,d.type));
  socket.on('chat:message',message=>appendChat(message,true));
  socket.on('connect',()=>toast('Verbunden mit dem globalen Goldmarkt.','success'));
  socket.on('disconnect',()=>{setText('#onlineCount','—');setText('#chatOnline','—');});
  socket.on('connect_error',()=>console.warn('WebSocket connection unavailable'));
}
function showPage(page){
  state.currentPage=page;
  qsa('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+page));
  qsa('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  const labels={terminal:'XAU/USD TERMINAL',leaderboard:'BESTENLISTE',affiliate:'AFFILIATE PROGRAM',profile:'MEIN PROFIL'};
  setText('#currentPageLabel',labels[page]);
  qs('.sidebar').classList.remove('open');
  if(page==='leaderboard')loadLeaderboard();
  if(page==='profile')renderTransactions();
  if(page==='terminal')setTimeout(drawChart,10);
  window.scrollTo({top:0,behavior:'smooth'});
}
function showPrice(){
  setText('#headerPrice',fmt(state.price));setText('#heroPrice',money(state.price));
  setText('#bidPrice',fmt(state.price-.12));setText('#askPrice',fmt(state.price+.12));
  const delta=state.price-state.prevPrice;
  setText('#headerChange',(delta>0?'▲ ':delta<0?'▼ ':'')+fmt(Math.abs(delta)));
  qs('#headerChange').className='header-change '+pclass(delta);
  estimateMargin();
}
function estimateMargin(){
  const qty=Number(qs('#quantityInput').value)||0;
  const target=state.price;
  setText('#estimatedMargin',money(target*qty/20));
}
function receiveTick(t){
  if(!t||!Number.isFinite(Number(t.price)))return;
  state.prevPrice=state.price;
  state.price=Number(t.price);
  if(t.online!=null){setText('#onlineCount',t.online);setText('#chatOnline',t.online);}
  showPrice();mergeCandle(Number(t.time)||Math.floor(Date.now()/1000));
  updateAccountWidgets();
  if(state.tab==='positions')updatePositionPnLCells();
}
const intervals={'1s':1,'5s':5,'15s':15,'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1D':86400};
async function loadCandles(){
  try{
    const interval=state.interval;
    const rows=await api('/api/market/candles?interval='+encodeURIComponent(interval));
    if(interval!==state.interval)return;
    state.candles=rows;
    state.offset=0;
    qs('#chartLoader').classList.add('hidden');
    drawChart();
  }catch(e){setText('#chartLoader','CHART: '+e.message);}
}
function mergeCandle(time){
  const secs=intervals[state.interval]||60;
  const bucket=Math.floor(time/secs)*secs;
  const a=state.candles;
  const last=a[a.length-1];
  if(!last||bucket>last.time){a.push({time:bucket,open:last?last.close:state.price,high:state.price,low:state.price,close:state.price});if(a.length>1500)a.shift();}
  else if(bucket===last.time){last.high=Math.max(last.high,state.price);last.low=Math.min(last.low,state.price);last.close=state.price;}
  drawChart();
}
function drawChart(){
  const canvas=qs('#chartCanvas');
  if(!canvas||!canvas.parentElement||state.currentPage!=='terminal')return;
  const box=canvas.parentElement.getBoundingClientRect();
  const w=Math.floor(box.width),h=Math.floor(box.height);
  if(w<30||h<30)return;
  const dpr=window.devicePixelRatio||1;
  if(canvas.width!==Math.floor(w*dpr)||canvas.height!==Math.floor(h*dpr)){canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#12171d';ctx.fillRect(0,0,w,h);
  const left=14,right=74,top=10,bottom=30,plotW=w-left-right,plotH=h-top-bottom;
  const list=state.candles;
  const maxOffset=Math.max(0,list.length-state.viewCount);
  state.offset=Math.min(Math.max(0,state.offset),maxOffset);
  const end=Math.max(0,list.length-state.offset);
  const start=Math.max(0,end-state.viewCount);
  const shown=list.slice(start,end);
  if(!shown.length){ctx.fillStyle='#73808e';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Warte auf Live-Marktdaten …',w/2,h/2);return;}
  let hi=Math.max(...shown.map(c=>c.high),state.price),lo=Math.min(...shown.map(c=>c.low),state.price);
  state.positions.filter(p=>p.status==='open').forEach(p=>{hi=Math.max(hi,Number(p.entry_price),Number(p.sl||0),Number(p.tp||0));lo=Math.min(lo,Number(p.entry_price),Number(p.sl||1e9),Number(p.tp||1e9));});
  const pad=Math.max(2,(hi-lo)*.12);hi+=pad;lo-=pad;
  const y=v=>top+(hi-v)/(hi-lo)*plotH;
  const x=i=>left+(i+.5)*plotW/shown.length;
  ctx.strokeStyle='#252d3566';ctx.lineWidth=1;ctx.font='10px "Segoe UI",sans-serif';ctx.fillStyle='#87939e';
  for(let i=0;i<=5;i++){const yy=top+i*plotH/5;ctx.beginPath();ctx.moveTo(left,yy+.5);ctx.lineTo(w-right,yy+.5);ctx.stroke();ctx.textAlign='left';ctx.fillText(fmt(hi-i*(hi-lo)/5),w-right+8,yy+3);}
  for(let i=0;i<=6;i++){const xx=left+i*plotW/6;ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,h-bottom);ctx.stroke();}
  const cw=Math.max(2,Math.min(17,plotW/shown.length*.68));
  shown.forEach((c,i)=>{
    const color=c.close>=c.open?'#0dc79f':'#fa5b69',xx=x(i);
    ctx.strokeStyle=color;ctx.fillStyle=color;
    ctx.beginPath();ctx.moveTo(xx,Math.round(y(c.high)));ctx.lineTo(xx,Math.round(y(c.low)));ctx.stroke();
    const yy=y(Math.max(c.open,c.close)),hh=Math.max(1,Math.abs(y(c.open)-y(c.close)));
    ctx.fillRect(xx-cw/2,yy,cw,hh);
  });
  const drawLine=(value,color,label,dash)=>{
    if(value==null)return;
    const yy=y(Number(value));if(yy<top-5||yy>h-bottom+5)return;
    ctx.save();ctx.setLineDash(dash?[5,5]:[4,3]);ctx.strokeStyle=color;ctx.globalAlpha=.75;
    ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.restore();
    ctx.fillStyle=color;ctx.fillRect(w-right,yy-9,right,18);
    ctx.fillStyle='#0a1013';ctx.font='bold 10px sans-serif';ctx.textAlign='left';ctx.fillText(label+' '+fmt(value),w-right+4,yy+3);
  };
  state.positions.filter(p=>p.status==='open').slice(0,3).forEach(p=>{
    drawLine(Number(p.entry_price),'#c2a45e','IN',true);
    if(p.sl!=null)drawLine(Number(p.sl),'#fa5b69','SL',true);
    if(p.tp!=null)drawLine(Number(p.tp),'#0dc79f','TP',true);
  });
  drawLine(state.price,'#d5ac60','',false);
  ctx.fillStyle='#788591';ctx.font='10px "Segoe UI",sans-serif';ctx.textAlign='center';
  const span=Math.max(1,Math.floor(shown.length/5));
  for(let i=0;i<shown.length;i+=span){
    const d=new Date(shown[i].time*1000);
    const text=state.interval==='1D'?(d.getMonth()+1)+'/'+d.getDate():d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    ctx.fillText(text,x(i),h-11);
  }
  if(state.crosshair&&state.crosshair.x>=left&&state.crosshair.x<=w-right&&state.crosshair.y>=top&&state.crosshair.y<=h-bottom){
    const c=state.crosshair;
    ctx.save();ctx.setLineDash([3,4]);ctx.strokeStyle='#a5b0bd88';
    ctx.beginPath();ctx.moveTo(c.x,top);ctx.lineTo(c.x,h-bottom);ctx.moveTo(left,c.y);ctx.lineTo(w-right,c.y);ctx.stroke();ctx.restore();
    const index=Math.max(0,Math.min(shown.length-1,Math.floor((c.x-left)/plotW*shown.length)));
    const hover=shown[index];
    if(hover){updateOHLC(hover);ctx.fillStyle='#252c35';ctx.fillRect(w-right,c.y-10,right,20);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.fillText(fmt(hi-(c.y-top)/plotH*(hi-lo)),w-right+5,c.y+4);}
  }else updateOHLC(shown[shown.length-1]);
}
function updateOHLC(c){
  if(!c)return;
  setText('#chartO',fmt(c.open));setText('#chartH',fmt(c.high));setText('#chartL',fmt(c.low));setText('#chartC',fmt(c.close));
}
function initChartControls(){
  const canvas=qs('#chartCanvas');
  canvas.addEventListener('mousemove',e=>{
    const r=canvas.getBoundingClientRect();
    state.crosshair={x:e.clientX-r.left,y:e.clientY-r.top};
    if(state.dragging)state.offset=Math.max(0,state.dragStart+Math.round((e.clientX-state.dragX)*-state.viewCount/Math.max(150,r.width-90)));
    drawChart();
  });
  canvas.addEventListener('mouseleave',()=>{state.crosshair=null;state.dragging=false;drawChart();});
  canvas.addEventListener('mousedown',e=>{state.dragging=true;state.dragX=e.clientX;state.dragStart=state.offset;});
  window.addEventListener('mouseup',()=>{state.dragging=false;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.viewCount=Math.min(200,Math.max(18,state.viewCount+(e.deltaY>0?10:-10)));drawChart();},{passive:false});
  window.addEventListener('resize',drawChart);
  qs('#resetChart').onclick=()=>{state.offset=0;state.viewCount=70;drawChart();};
  qsa('#timeframes button').forEach(btn=>btn.onclick=()=>{
    state.interval=btn.dataset.interval;
    qsa('#timeframes button').forEach(x=>x.classList.toggle('selected',x===btn));
    loadCandles();
  });
}
function renderPositions(){
  const active=state.positions.filter(p=>p.status==='open');
  const orders=state.orders.filter(o=>o.status==='pending');
  const history=state.positions.filter(p=>p.status==='closed');
  setText('#positionCount',active.length);setText('#pendingCount',orders.length);
  let headers=[],rows=[];
  if(state.tab==='positions'){
    headers=['ID','RICHTUNG','GRÖSSE','EINSTIEG','AKTUELL','SL / TP','P&L','AKTION'];
    rows=active.map(p=>'<tr><td>#'+esc(p.id)+'</td><td class="'+(p.side==='buy'?'positive':'negative')+'">'+(p.side==='buy'?'↗ BUY':'↘ SELL')+'</td><td>'+fmt(p.quantity,3)+' oz</td><td>'+fmt(p.entry_price)+'</td><td class="live-exit">'+fmt(state.price)+'</td><td>'+esc(p.sl==null?'—':fmt(p.sl))+' / '+esc(p.tp==null?'—':fmt(p.tp))+'</td><td class="live-pnl '+pclass(positionPnl(p))+'" data-pos="'+esc(p.id)+'">'+money(positionPnl(p))+'</td><td><button class="table-action" data-close="'+esc(p.id)+'">SCHLIESSEN</button></td></tr>');
  }else if(state.tab==='pending'){
    headers=['ID','RICHTUNG','TYP','MENGE','ZIELPREIS','SL / TP','AKTION'];
    rows=orders.map(o=>'<tr><td>#'+esc(o.id)+'</td><td class="'+(o.side==='buy'?'positive':'negative')+'">'+esc(o.side.toUpperCase())+'</td><td>'+esc(o.order_type.toUpperCase())+'</td><td>'+fmt(o.quantity,3)+' oz</td><td>'+fmt(o.target_price)+'</td><td>'+esc(o.sl==null?'—':fmt(o.sl))+' / '+esc(o.tp==null?'—':fmt(o.tp))+'</td><td><button class="table-action" data-cancel="'+esc(o.id)+'">STORNIEREN</button></td></tr>');
  }else{
    headers=['ID','RICHTUNG','GRÖSSE','EINSTIEG','AUSSTIEG','GEWINN / VERLUST','GRUND','ZEIT'];
    rows=history.map(p=>'<tr><td>#'+esc(p.id)+'</td><td class="'+(p.side==='buy'?'positive':'negative')+'">'+esc(p.side.toUpperCase())+'</td><td>'+fmt(p.quantity,3)+' oz</td><td>'+fmt(p.entry_price)+'</td><td>'+fmt(p.exit_price)+'</td><td class="'+pclass(p.pnl)+'">'+money(p.pnl)+'</td><td>'+esc(p.close_reason)+'</td><td>'+date(p.closed_at)+'</td></tr>');
  }
  qs('#positionHead').innerHTML='<tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr>';
  qs('#positionBody').innerHTML=rows.join('')||'<tr><td class="table-empty" colspan="'+headers.length+'">Noch keine '+(state.tab==='positions'?'offenen Positionen':state.tab==='pending'?'Pending Orders':'abgeschlossenen Trades')+'. Starte deinen ersten Trade!</td></tr>';
  qsa('[data-close]').forEach(btn=>btn.onclick=async()=>{
    btn.disabled=true;
    try{const r=await api('/api/positions/'+btn.dataset.close+'/close',{method:'POST'});toast('Position geschlossen · '+money(r.pnl),r.pnl>=0?'success':'danger');await refreshAccount();}
    catch(e){toast(e.message,'danger');btn.disabled=false;}
  });
  qsa('[data-cancel]').forEach(btn=>btn.onclick=async()=>{
    btn.disabled=true;
    try{await api('/api/orders/'+btn.dataset.cancel+'/cancel',{method:'POST'});toast('Pending Order storniert.');await refreshAccount();}
    catch(e){toast(e.message,'danger');btn.disabled=false;}
  });
}
function updatePositionPnLCells(){
  state.positions.filter(p=>p.status==='open').forEach(p=>{
    const elem=qs('[data-pos="'+p.id+'"]');
    if(elem){elem.textContent=money(positionPnl(p));elem.className='live-pnl '+pclass(positionPnl(p));}
  });
  qsa('.live-exit').forEach(el=>el.textContent=fmt(state.price));
}
async function loadLeaderboard(){
  try{
    const rows=await api('/api/leaderboard?mode='+state.rank);
    qs('#rankingBody').innerHTML=rows.map((r,i)=>{
      const rate=r.trades?fmt(r.wins/r.trades*100,1)+'%':'—';
      return '<tr><td><span class="rank-number '+(i<3?'top':'')+'">'+(i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1))+'</span></td><td class="trader-name"><span class="trader-avatar">'+esc(r.username[0].toUpperCase())+'</span>'+esc(r.username)+'</td><td class="'+pclass(r.profit)+'">'+money(r.profit)+'</td><td>'+money(r.balance)+'</td><td>'+rate+'</td><td>'+r.trades+'</td></tr>';
    }).join('')||'<tr><td colspan="6" class="table-empty">Noch keine Trader vorhanden.</td></tr>';
  }catch(e){qs('#rankingBody').innerHTML='<tr><td colspan="6">'+esc(e.message)+'</td></tr>';}
}
function renderTransactions(){
  qs('#transactionList').innerHTML=(state.transactions||[]).map(t=>'<div class="transaction"><div><b>'+esc(t.description)+'</b><small>'+date(t.created_at)+'</small></div><strong class="'+pclass(t.amount)+'">'+(Number(t.amount)>=0?'+':'')+money(t.amount)+'</strong></div>').join('')||'<div class="table-empty">Noch keine Kontobewegungen.</div>';
}
function appendChat(m,scroll){
  const box=qs('#chatMessages');
  if(box.querySelector('.empty-chat'))box.innerHTML='';
  const node=document.createElement('div');
  node.className='message'+(state.user?.username===m.username?' mine':'');
  const meta=document.createElement('div');meta.className='message-meta';
  const name=document.createElement('span');name.className='message-user';name.textContent=m.username;
  const time=document.createElement('span');time.className='message-time';
  time.textContent=new Date(m.created_at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const body=document.createElement('div');body.className='message-body';body.textContent=m.body;
  meta.append(name,time);node.append(meta,body);box.append(node);
  while(box.children.length>90)box.firstElementChild.remove();
  if(scroll)box.scrollTop=box.scrollHeight;
}
async function loadChat(){
  try{
    const messages=await api('/api/chat');
    qs('#chatMessages').innerHTML='';
    if(!messages.length){qs('#chatMessages').innerHTML='<div class="empty-chat">Noch keine Nachrichten. Starte die Unterhaltung!</div>';return;}
    messages.forEach(m=>appendChat(m,false));
    qs('#chatMessages').scrollTop=qs('#chatMessages').scrollHeight;
  }catch(e){console.warn(e);}
}
function setSide(side){
  state.side=side;
  qs('#buyBtn').classList.toggle('active',side==='buy');
  qs('#sellBtn').classList.toggle('active',side==='sell');
  const b=qs('#submitOrder');b.className='place-order '+(side==='buy'?'buy-order':'sell-order');
  b.textContent=side==='buy'?'↗ BUY GOLD':'↘ SELL GOLD';
}
function bindEvents(){
  qsa('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
  qs('#menuBtn').onclick=()=>qs('.sidebar').classList.toggle('open');
  qsa('.tabs button').forEach(btn=>btn.onclick=()=>{
    state.tab=btn.dataset.tab;qsa('.tabs button').forEach(x=>x.classList.toggle('active',x===btn));renderPositions();
  });
  qs('#refreshPositions').onclick=refreshAccount;
  qsa('[data-rank]').forEach(btn=>btn.onclick=()=>{
    state.rank=btn.dataset.rank;
    qsa('[data-rank]').forEach(x=>x.classList.toggle('active',x===btn));loadLeaderboard();
  });
  qs('#buyBtn').onclick=()=>setSide('buy');
  qs('#sellBtn').onclick=()=>setSide('sell');
  qs('#orderType').onchange=()=>qs('#targetRow').classList.toggle('hidden',qs('#orderType').value==='market');
  qs('#quantityInput').oninput=estimateMargin;
  qs('#orderForm').onsubmit=async(e)=>{
    e.preventDefault();if(!state.user)return showAuth();
    const btn=qs('#submitOrder'),original=btn.textContent;
    btn.disabled=true;btn.textContent='ORDER WIRD AUSGEFÜHRT …';
    const optional=id=>qs(id).value.trim()===''?null:Number(qs(id).value);
    const payload={side:state.side,type:qs('#orderType').value,quantity:Number(qs('#quantityInput').value),
      targetPrice:optional('#targetInput'),sl:optional('#slInput'),tp:optional('#tpInput')};
    try{
      await api('/api/orders',{method:'POST',body:JSON.stringify(payload)});
      toast(payload.type==='market'?'Position erfolgreich eröffnet.':'Pending Order erstellt.','success');
      await refreshAccount();
    }catch(err){toast(err.message,'danger');}finally{btn.disabled=false;btn.textContent=original;}
  };
  qs('#chatForm').onsubmit=e=>{
    e.preventDefault();const input=qs('#chatInput');const body=input.value.trim();
    if(!body||!state.socket?.connected)return;
    state.socket.emit('chat:send',{body},ack=>{if(ack?.error)toast(ack.error,'danger');else input.value='';});
  };
  qs('#affiliateForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const data=await api('/api/affiliate',{method:'POST',body:JSON.stringify({code:qs('#affiliateInput').value})});
      state.user.affiliate_code=data.code;updateAccountWidgets();toast('Dein Affiliate-Code ist aktiv!','success');
    }catch(err){toast(err.message,'danger');}
  };
  qs('#copyAffiliate').onclick=async()=>{
    const url=DEMO_MODE?state.user.affiliate_code:location.href.split('?')[0]+'?ref='+encodeURIComponent(state.user.affiliate_code);
    try{await navigator.clipboard.writeText(url);toast(DEMO_MODE?'Code kopiert! Nur auf diesem Gerät einlösbar.':'Affiliate-Link kopiert!','success');}
    catch{toast('Kopiere deinen Code: '+state.user.affiliate_code);}
  };
  qs('#logoutBtn').onclick=async()=>{
    try{await api('/api/auth/logout',{method:'POST'});}catch{}
    if(state.socket)state.socket.disconnect();
    saveToken('');
    state.socket=null;state.user=null;state.positions=[];state.orders=[];state.transactions=[];
    showPage('terminal');showAuth();switchAuth('login');
  };
  qs('#loginTab').onclick=()=>switchAuth('login');
  qs('#registerTab').onclick=()=>switchAuth('register');
  qs('#switchRegister').onclick=()=>switchAuth('register');
  qs('#authForm').onsubmit=async e=>{
    e.preventDefault();setText('#authError','');
    const btn=qs('#authSubmit');btn.disabled=true;
    const data={username:qs('#authUsername').value,password:qs('#authPassword').value};
    if(authMode==='register'){data.affiliateCode=qs('#authAffiliate').value.trim()||undefined;}
    try{
      const out=await api('/api/auth/'+(authMode==='register'?'register':'login'),{method:'POST',body:JSON.stringify(data)});
      if(out.token && !DEMO_MODE)saveToken(out.token);
      await onAuthenticated(out.user);
      toast(authMode==='register'?'Willkommen bei GOLDX! Dein lokales Spielkonto ist bereit.':'Erfolgreich angemeldet.','success');
      qs('#authPassword').value='';
    }catch(err){setText('#authError',err.message);}
    finally{btn.disabled=false;}
  };
  initChartControls();
}
async function start(){
  bindEvents();

  showPrice();
  const ref=new URLSearchParams(location.search).get('ref');
  if(ref){qs('#authAffiliate').value=ref.replace(/[^A-Za-z0-9_]/g,'').slice(0,20).toUpperCase();switchAuth('register');}
  if (DEMO_MODE) {setText('#onlineCount','1');setText('#chatOnline','1');}
  try{
    const market=await api('/api/market');
    state.price=Number(market.price);state.prevPrice=state.price;showPrice();
  }catch(e){console.warn(e);}
  try{const data=await api('/api/me');if(data.user)await onAuthenticated(data.user);else showAuth();}
  catch{showAuth();}
  if(!state.user)loadCandles();
  if(DEMO_MODE)window.addEventListener('storage',e=>{
    if(e.key==='goldx_browser_game_v3'){
      refreshAccount();loadLeaderboard();loadChat();
    }
  });
  setInterval(()=>{if(state.user&&state.currentPage==='leaderboard')loadLeaderboard();},30000);
}
document.addEventListener('DOMContentLoaded',start);
