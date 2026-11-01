'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {TextEncoder}=require('node:util');

function loadGame(){
  const store=new Map();
  const localStorage={
    getItem:k=>store.has(k)?store.get(k):null,
    setItem:(k,v)=>store.set(String(k),String(v)),
    removeItem:k=>store.delete(k)
  };
  const context=vm.createContext({
    window:{},localStorage,crypto:webcrypto,TextEncoder,URL,
    location:{origin:'https://example.github.io'},
    Date,Math,JSON,Number,String,Array,Set,Map,Boolean,Promise,Error,RegExp
  });
  vm.runInContext(fs.readFileSync('public/demo.js','utf8'),context);
  return {game:context.window.GOLDX_DEMO,store};
}
const json=body=>({method:'POST',body:JSON.stringify(body)});
test('browser-only demo: username login, starting balance, local affiliate reward and trading',async()=>{
  const {game,store}=loadGame();
  const bad=game.request('/api/auth/login',json({username:'absent',password:'password123'}));
  await assert.rejects(bad,/Passwort falsch/);
  const user=await game.request('/api/auth/register',json({username:'FirstTrader',password:'password123'}));
  assert.equal(user.user.balance,1500);
  assert.equal(user.user.username,'FirstTrader');
  assert.equal(user.user.email,undefined);
  const duplicate=game.request('/api/auth/register',json({username:'firsttrader',password:'password123'}));
  await assert.rejects(duplicate,/bereits/);
  assert.ok(await game.request('/api/me'));
  const aff=await game.request('/api/affiliate',json({code:'FRIEND2026'}));
  assert.equal(aff.code,'FRIEND2026');
  await assert.rejects(game.request('/api/affiliate',json({code:'OTHER2026'})),/bereits/);
  await game.request('/api/auth/logout',{method:'POST'});
  const second=await game.request('/api/auth/register',json({
    username:'SecondTrader',password:'password456',affiliateCode:'FRIEND2026'
  }));
  assert.equal(second.user.balance,3500);
  await game.request('/api/auth/logout',{method:'POST'});
  const login=await game.request('/api/auth/login',json({username:'FirstTrader',password:'password123'}));
  assert.equal(login.user.balance,2500);
  assert.equal(login.user.referrals,1);
  const market=await game.request('/api/market');
  assert.equal(market.simulated,true);
  assert.ok(market.price>0);
  const candles=await game.request('/api/market/candles?interval=1m');
  assert.ok(candles.length>100);
  const opened=await game.request('/api/orders',json({side:'buy',quantity:.1,type:'market',sl:null,tp:null}));
  assert.equal(opened.order.status,'open');
  const before=await game.request('/api/me');
  assert.equal(before.positions.filter(x=>x.status==='open').length,1);
  const exit=await game.request('/api/positions/'+opened.order.id+'/close',{method:'POST'});
  assert.equal(exit.ok,true);
  const after=await game.request('/api/me');
  assert.equal(after.user.trades,1);
  assert.ok(after.user.balance>=0);
  const pending=await game.request('/api/orders',json({side:'buy',quantity:.1,type:'limit',
    targetPrice:Math.floor(market.price-50)}));
  assert.equal(pending.order.status,'pending');
  assert.equal((await game.request('/api/orders/'+pending.order.id+'/cancel',{method:'POST'})).ok,true);
  const message=game.sendChat('Hallo Browser-Demo!');
  assert.equal(message.ok,true);
  assert.equal((await game.request('/api/chat')).slice(-1)[0].body,'Hallo Browser-Demo!');
  const ranking=await game.request('/api/leaderboard?mode=profit');
  assert.equal(ranking.length,2);
  assert.equal(store.has('goldx_browser_game_v3'),true);
  assert.ok(game.tick().price>0);
});
