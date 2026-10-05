const test = require('node:test');
const assert = require('node:assert/strict');
const {createTrendSnapshotStore} = require('../src/services/fuel/trendSnapshotStore');
const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r}); return {promise,resolve}; };

test('saved Trends survive a fresh process, remain scope isolated, and expire after 24 hours', async () => {
    const disk=new Map();let now=1000000;
    const storage={getItem:async k=>disk.get(k),setItem:async(k,v)=>disk.set(k,v)};
    const first=createTrendSnapshotStore(storage,()=>now);
    await first.set('local:regular:27,-82:6',{leaderboard:[{stationId:'a'}]});
    await first.set('national:premium',{quotes:[]});
    const second=createTrendSnapshotStore(storage,()=>now);
    assert.equal((await second.get('local:regular:27,-82:6')).leaderboard[0].stationId,'a');
    assert.equal(await second.get('local:regular:40,-74:6'),null);
    now+=86400000;
    assert.equal(await second.get('local:regular:27,-82:6'),null);
});

test('reset wins against a delayed disk read and a concurrent save', async () => {
    const read=deferred();let saved;
    const store=createTrendSnapshotStore({getItem:()=>read.promise,setItem:async(_,v)=>{saved=v}},()=>1000);
    const pendingGet=store.get('old');
    const pendingSet=store.set('new',{price:4});
    await store.clear();
    read.resolve(JSON.stringify([['old',{savedAt:1000,value:{price:3}}]]));
    await pendingSet;
    assert.equal(await pendingGet,null);
    assert.deepEqual(JSON.parse(saved),[]);
});

test('concurrent saves are serialized, storage stays bounded, and unavailable storage is nonfatal', async () => {
    let saved;
    const storage={getItem:async()=>null,setItem:async(_,value)=>{saved=value}};
    const store=createTrendSnapshotStore(storage,()=>1000);
    await Promise.all(Array.from({length:12},(_,i)=>store.set(`scope:${i}`,{price:i})));
    assert.equal(JSON.parse(saved).length,8);
    assert.equal(await store.get('scope:0'),null);
    assert.deepEqual(await store.get('scope:11'),{price:11});
    const failed=createTrendSnapshotStore({getItem:async()=>{throw Error('disk')},setItem:async()=>{throw Error('disk')}});
    await failed.set('a',{price:3});
    assert.deepEqual(await failed.get('a'),{price:3});
});
