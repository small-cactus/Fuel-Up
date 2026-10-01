import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('AFDC import accepts public card-payment sites but excludes restricted, private and unavailable stations',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'e85-directory-test-'));
 try {
 const input=path.join(dir,'source.json'), output=path.join(dir,'import.sql');
 const base={country:'US',fuel_type_code:'E85',status_code:'E',access_code:'public',restricted_access:false,
  access_detail_code:null,station_name:"O'Brien Fuel",street_address:'100 Main St',city:'Example',state:'FL',latitude:28,longitude:-82};
 const rows=Array.from({length:1000},(_,i)=>({...base,id:i+1}));
 rows.push({...base,id:1001,access_detail_code:'CREDIT_CARD_ALWAYS'}, {...base,id:1002,access_detail_code:'CREDIT_CARD_AFTER_HOURS'},
 {...base,id:1003,access_detail_code:'KEY_ALWAYS'}, {...base,id:1004,access_code:'private'},
 {...base,id:1005,status_code:'T'}, {...base,id:1006,restricted_access:true});
 writeFileSync(input,JSON.stringify({total_results:rows.length,fuel_stations:rows}));
 const summary=JSON.parse(execFileSync(process.execPath,['scripts/e85-directory/prepareImport.mjs',input,output],{encoding:'utf8'}));
 assert.equal(summary.publicUnrestricted,1002);
 const sql=readFileSync(output,'utf8');assert(sql.startsWith('BEGIN;'));assert(sql.includes('COMMIT;'));
 assert(sql.includes("O''Brien Fuel"));assert(!sql.includes('UPDATE fuel_station_latest'));
 writeFileSync(input,JSON.stringify({total_results:rows.length+1,fuel_stations:rows}));
 assert.throws(()=>execFileSync(process.execPath,['scripts/e85-directory/prepareImport.mjs',input,output],{stdio:'pipe'}));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
