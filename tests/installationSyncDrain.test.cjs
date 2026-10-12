const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('usage command waits for durable acknowledgments and does not complete on cancellation or unreadable outbox',()=>{
 const source=fs.readFileSync('modules/fuel-up-driving-activity/ios/Telemetry/InstallationTelemetry.swift','utf8');
 const method=source.slice(source.indexOf('  func drainForSync()'),source.indexOf('  func foreground()'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuel-usage-drain-'));
 try {
 fs.writeFileSync(path.join(dir,'main.swift'),`
import Foundation
@MainActor class Store {
 var pending=2,broken=false
 func counts() throws -> (pending:Int,total:Int) {if broken {throw URLError(.cannotDecodeRawData)};return (pending,2)}
}
@MainActor class Uploader {
 var flushes=0,acknowledge=false;let store:Store
 init(_ store:Store){self.store=store}
 func flush(){flushes+=1;if acknowledge && flushes>=3 {store.pending=0}}
}
@MainActor class Telemetry {
 var store:Store?;var uploader:Uploader?
 init(){let s=Store();store=s;uploader=Uploader(s)}
 func start(){}
 ${method}
}
@main struct Main {
 @MainActor static func main() async {
  let t=Telemetry();t.uploader!.acknowledge=true
  let completed=await t.drainForSync();assert(completed && t.uploader!.flushes>=3)
  let broken=Telemetry();broken.store!.broken=true
  let failed=await broken.drainForSync();assert(!failed && broken.store!.pending==2)
  let cancelled=Telemetry();let task=Task {await cancelled.drainForSync()}
  try? await Task.sleep(for:.milliseconds(400));task.cancel()
  let result=await task.value;assert(!result && cancelled.store!.pending==2)
  print("PASS: acknowledgments, disk error, cancellation preserve pending data")
 }
}`);
 execFileSync('swiftc',['-parse-as-library',path.join(dir,'main.swift'),'-o',path.join(dir,'test')],{timeout:60000});
 assert.match(execFileSync(path.join(dir,'test'),{encoding:'utf8',timeout:10000}),/PASS:/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
