'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 32077;
const BASE = 'http://127.0.0.1:' + PORT;
const pause = ms => new Promise(r=>setTimeout(r,ms));

async function request(route, method='GET', body, cookie) {
  const res=await fetch(BASE+route,{method,
    headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:body?JSON.stringify(body):undefined});
  const json=await res.json();
  return {status:res.status,data:json,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function waitForServer(child) {
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw new Error('Server exited early: '+child.exitCode);
    try {const h=await request('/api/health');if(h.data.ok)return;}catch{}
    await pause(500);
  }
  throw new Error('Server did not start in time');
}
test('GOLDX registration, bonus, account, live market, orders, chat', {timeout:110000}, async()=>{
  const child=spawn(process.execPath,['server.js'],{
    env:{...process.env,PORT:String(PORT),NODE_ENV:'test'},
    stdio:['ignore','pipe','pipe']
  });
  let log='';
  child.stdout.on('data',b=>{log+=b.toString();});
  child.stderr.on('data',b=>{log+=b.toString();});
  let socket;
  try {
    await waitForServer(child);
    const rnd=Math.random().toString(36).slice(2,9);
    const one=await request('/api/auth/register','POST',{
      username:'Trader'+rnd,email:'trader'+rnd+'@example.com',password:'TestPassword123!'
    });
    assert.equal(one.status,201,JSON.stringify(one.data));
    assert.equal(one.data.user.balance,1500);
    assert.ok(one.cookie);
    const code='TEST'+rnd.toUpperCase();
    const affiliate=await request('/api/affiliate','POST',{code},one.cookie);
    assert.equal(affiliate.status,201,JSON.stringify(affiliate.data));
    const again=await request('/api/affiliate','POST',{code:code+'2'},one.cookie);
    assert.equal(again.status,409);
    const two=await request('/api/auth/register','POST',{
      username:'Friend'+rnd,email:'friend'+rnd+'@example.com',
      password:'TestPassword123!',affiliateCode:code
    });
    assert.equal(two.status,201,JSON.stringify(two.data));
    assert.equal(two.data.user.balance,3500);
    const after=await request('/api/me','GET',undefined,one.cookie);
    assert.equal(after.data.user.balance,2500);
    assert.equal(after.data.user.referrals,1);
    const market=await request('/api/market');
    assert.equal(market.data.simulated,true);
    assert.ok(Number(market.data.price)>0);
    const candle=await request('/api/market/candles?interval=1m');
    assert.equal(candle.status,200,JSON.stringify(candle.data));
    assert.ok(candle.data.length>=20);
    const trade=await request('/api/orders','POST',{side:'buy',type:'market',quantity:0.1},one.cookie);
    assert.equal(trade.status,201,JSON.stringify(trade.data));
    const p=await request('/api/me','GET',undefined,one.cookie);
    const position=p.data.positions.find(item=>item.status==='open');
    assert.ok(position);
    const closed=await request('/api/positions/'+position.id+'/close','POST',{},one.cookie);
    assert.equal(closed.status,200,JSON.stringify(closed.data));
    const prof=await request('/api/me','GET',undefined,one.cookie);
    assert.equal(prof.data.user.trades,1);
    assert.ok(prof.data.user.balance>=0);
    const pending=await request('/api/orders','POST',{
      side:'buy',type:'limit',quantity:0.1,targetPrice:Math.floor(Number(market.data.price)-50),
    },one.cookie);
    assert.equal(pending.status,201,JSON.stringify(pending.data));
    const canceled=await request('/api/orders/'+pending.data.order.id+'/cancel','POST',{},one.cookie);
    assert.equal(canceled.status,200);
    const ranking=await request('/api/leaderboard?mode=profit');
    assert.equal(ranking.status,200);
    assert.ok(ranking.data.find(item=>item.username==='Trader'+rnd));
    socket=io(BASE,{transports:['websocket'],extraHeaders:{Cookie:one.cookie}});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Socket connection timed out')),10000);
      socket.once('connect',()=>{clearTimeout(timer);resolve();});
      socket.once('connect_error',e=>{clearTimeout(timer);reject(e);});
    });
    const ack=await new Promise(resolve=>socket.emit('chat:send',{body:'Hello world test'},resolve));
    assert.equal(ack.ok,true,JSON.stringify(ack));
    const chat=await request('/api/chat');
    assert.ok(chat.data.some(m=>m.body==='Hello world test'));
  } catch(e) {
    console.error(log);
    throw e;
  } finally {
    if(socket)socket.disconnect();
    child.kill('SIGTERM');
    await pause(250);
  }
});
