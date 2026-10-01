const test=require('node:test');
const assert=require('node:assert/strict');
const {buildDisplayTrendSeries}=require('../src/screens/trends/displayTrendSeries');
const hour=3600000,now=Date.parse('2026-10-01T18:00:00Z');
const point=(hoursAgo,price)=>({date:new Date(now-hoursAgo*hour).toISOString(),price});
test('missing hourly buckets and trailing time carry the last observed price without mutating observations',()=>{
 const raw=[point(6,3),point(2,4)];const original=JSON.stringify(raw);
 const filled=buildDisplayTrendSeries(raw,{now});
 assert.deepEqual(filled.map(p=>p.price),[3,3,3,3,4,4,4]);
 assert.equal(filled.at(-1).date,new Date(now).toISOString());
 assert.equal(JSON.stringify(raw),original);
 assert.equal(filled.filter(p=>!p.carriedForward).length,2);
});
test('a single current observation creates a flat renderable line without fake price changes',()=>{
 const filled=buildDisplayTrendSeries([point(0,3.2)],{now});
 assert.equal(filled.length,2);assert(filled.every(p=>p.price===3.2&&p.date===point(0,3.2).date));
});
test('new local areas use their actual current average; completely absent data stays absent',()=>{
 assert.deepEqual(buildDisplayTrendSeries([],{now}),[]);
 const filled=buildDisplayTrendSeries([],{now,latestObservedAverage:point(2,3.5)});
 assert(filled.length>=2);assert(filled.every(p=>p.price===3.5));
 assert.deepEqual(buildDisplayTrendSeries([point(-1,2),{date:'bad',price:3}],{now}),[]);
});
