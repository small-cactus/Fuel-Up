import test from 'node:test';import assert from 'node:assert/strict';
import {catalogFromDiscovery} from '../scripts/national-prices/catalogFromDiscovery.mjs';
const observation=(scopes,kind='states')=>({observedAt:new Date().toISOString(),task:{kind},scopes});
const scope=(state,ids,count=ids.length,scopeMatches=true)=>({state,stations:ids.map(id=>({id})),returnedCount:ids.length,reportedCount:count,fullResponse:ids.length===count,scopeMatches});
test('local geocoder result cannot masquerade as complete state inventory',()=>{
 const c=catalogFromDiscovery([observation([scope('CT',['1','2'],2,false)])]);
 assert.equal(c.complete,false);assert.equal(c.regions.length,0);assert.match(c.gaps.find(g=>g.code==='CT').reason,/scope/);
});
test('partial brand union must match statewide count exactly, including unpriced IDs',()=>{
 const partial=observation([scope('TX',['1','2'],4)]);
 const c=catalogFromDiscovery([partial,observation([scope('TX',['2','3'])],'brands')]);
 assert.equal(c.gaps.find(g=>g.code==='TX').known,3);
 const complete=catalogFromDiscovery([partial,observation([scope('TX',['2','3','4'])],'brands')]);
 assert.deepEqual(complete.regions.find(r=>r.code==='TX').ids,['1','2','3','4']);
 assert.equal(complete.complete,false);
});
test('stale discovery cannot renew a catalog timestamp',()=>{
 const old=observation([scope('FL',['1'])]);old.observedAt=new Date(Date.now()-86400001).toISOString();
 assert.equal(catalogFromDiscovery([old]).regions.length,0);
});
