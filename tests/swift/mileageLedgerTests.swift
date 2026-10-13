import Foundation

func fix(_ t:Double,_ lat:Double=0,_ lon:Double=0,_ receipt:Double?=nil,_ speed:Double=10,_ accuracy:Double=5)->ResearchFix {
  ResearchFix(timestamp:t,receivedAt:receipt ?? t,latitude:lat,longitude:lon,accuracy:accuracy,speed:speed,course:90,speedAccuracy:1,simulated:false,accessory:false)
}
func close(_ a:Double,_ b:Double) {assert(abs(a-b)<0.01,"\(a) != \(b)")}
@main struct MileageTests {
  static func main() throws {
    let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
    defer {try? FileManager.default.removeItem(at:directory)}
    let service=try DrivingResearchMileage(directory:directory,now:0)
    // A corner between upload samples must contribute both legs, not its chord.
    let batch=[fix(1),fix(3,0,0.0002),fix(5,0.0002,0.0002)]
    try service.process(batch)
    let legs=ResearchFix.distance(0,0,0,0.0002)+ResearchFix.distance(0,0.0002,0.0002,0.0002)
    close(service.state.meters,legs)
    assert(service.state.meters>ResearchFix.distance(0,0,0.0002,0.0002))
    let restored=try DrivingResearchMileage(directory:directory,now:50)
    try restored.process(batch)
    close(restored.state.meters,legs)
    assert(restored.state.duplicateSamples==3,"Restart and duplicate batch cannot double count")
    var delayed=ResearchMileageState(collectingSince:0)
    for point in batch {var f=point;f=fix(f.timestamp,f.latitude,f.longitude,100);delayed.process(f)}
    close(delayed.meters,legs);assert(delayed.delayedSamples==3)
    assert(fix(1,0,0,100).rejection != nil,"Delayed mileage must not relax live detector freshness")
    var gaps=ResearchMileageState(collectingSince:0)
    gaps.process(fix(1));gaps.process(fix(301,0,0.01))
    close(gaps.meters,0);assert(gaps.gaps==1 && gaps.gapSeconds==300)
    var spike=ResearchMileageState(collectingSince:0)
    spike.process(fix(1));spike.process(fix(2,1,1));spike.process(fix(3,0,0.0002))
    close(spike.meters,ResearchFix.distance(0,0,0,0.0002));assert(spike.rejectedSamples==1)
    var drift=ResearchMileageState(collectingSince:0)
    for t in 1...10 {drift.process(fix(Double(t),0,Double(t)*0.000001,nil,0,20))}
    close(drift.meters,0)
    try restored.boundary(at:200)
    try restored.process([fix(100,0,0.05,205),fix(201,0,0.1)])
    close(restored.state.meters,legs)
    assert(restored.state.boundaryCount==1 && restored.state.rejectedSamples==1)
    let paused=try DrivingResearchMileage(directory:directory,now:202)
    assert(paused.state.collectingSince==200)
    var invalid=ResearchMileageState(collectingSince:50)
    for f in [fix(40),fix(100,0,0,90),fix(60,0,0,90000),fix(60,0,0,nil,10,100),fix(60,.nan)] {invalid.process(f)}
    assert(invalid.acceptedSamples==0 && invalid.rejectedSamples==5)
    assert(ResearchDrivingMode.active(now:250,lastDrive:0,stationarySince:200))
    assert(!ResearchDrivingMode.active(now:501,lastDrive:0,stationarySince:200))
    assert(!ResearchDrivingMode.active(now:601,lastDrive:0,stationarySince:nil))
    assert(!ResearchDrivingMode.active(now:0,lastDrive:10,stationarySince:nil))
    try JSONSerialization.data(withJSONObject:restored.state.payload)
    try restored.erase()
    let erased=try DrivingResearchMileage(directory:directory,now:300)
    assert(erased.state.meters==0 && erased.state.epoch != service.state.epoch)
    // Invalid persisted state must surface an error rather than silently reset.
    try Data("invalid".utf8).write(to:directory.appendingPathComponent("mileage-v1.json"))
    do {_=try DrivingResearchMileage(directory:directory);assert(false)} catch {}
    print("PASS: full-batch corner distance, durable restart, duplicates, delayed fixes, live freshness isolation, gaps, teleports, stationary drift, pause boundaries, invalid data, driving hold, deletion and corrupt-state failure")
  }
}
