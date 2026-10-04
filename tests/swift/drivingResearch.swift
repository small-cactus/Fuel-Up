import Foundation

@main struct ResearchTests {
  static func main() throws {
    // A storm of sensor callbacks cannot defeat the network batching window.
    for now in stride(from: 0.0, to: 600.0, by: 0.25) {
      assert(!ResearchTransferPolicy.canUpload(now:now,lastAttempt:0,online:true,expensive:true,constrained:false))
    }
    assert(ResearchTransferPolicy.canUpload(now:600,lastAttempt:0,online:true,expensive:true,constrained:false))
    assert(!ResearchTransferPolicy.canUpload(now:299,lastAttempt:0,online:true,expensive:false,constrained:false))
    assert(ResearchTransferPolicy.canUpload(now:300,lastAttempt:0,online:true,expensive:false,constrained:false))
    assert(!ResearchTransferPolicy.canUpload(now:3600,lastAttempt:0,online:true,expensive:false,constrained:true))
    assert(!ResearchTransferPolicy.canUpload(now:3600,lastAttempt:0,online:false,expensive:false,constrained:false,manual:true))
    assert(ResearchTransferPolicy.canUpload(now:1,lastAttempt:0,online:true,expensive:true,constrained:true,manual:true))
    assert(!ResearchTransferPolicy.needsCatalog(moved:4999,age:1799,constrained:false))
    assert(ResearchTransferPolicy.needsCatalog(moved:5000,age:10,constrained:false))
    assert(!ResearchTransferPolicy.needsCatalog(moved:9999,age:3599,constrained:true))
    let station=ResearchStation(id:"s1",name:"Test Station",latitude:27,longitude:-82)
    func fix(_ time:Double,_ lat:Double=27,_ accuracy:Double=10,_ speed:Double=0,_ received:Double?=nil)->ResearchFix {
      ResearchFix(timestamp:time,receivedAt:received ?? time,latitude:lat,longitude:-82,accuracy:accuracy,speed:speed,course:0,speedAccuracy:1,simulated:false,accessory:false)
    }
    var d=ResearchVisitDetector()
    assert(d.process(fix(1000),stations:[station]).first?.0 == "visit_observation")
    assert(d.process(fix(1060),stations:[station]).isEmpty)
    assert(d.process(fix(1120),stations:[station]).first?.0 == "visit_candidate")
    assert(d.process(fix(1120),stations:[station]).isEmpty,"Duplicate fix must not inflate evidence")
    assert(d.process(fix(1140,27.0001,200),stations:[station]).isEmpty,"Bad accuracy must not prove a stop")
    assert(d.process(fix(1160,27.01,10,15),stations:[station]).first?.0 == "visit_departure")
    var pass=ResearchVisitDetector()
    assert(pass.process(fix(1000,27,10,15),stations:[station]).isEmpty,"Driving past is not a visit")
    assert(pass.process(fix(1000,27,10,0,1100),stations:[station]).isEmpty,"Cached fix is not evidence")
    var gap=ResearchVisitDetector()
    _=gap.process(fix(1000),stations:[station])
    assert(gap.process(fix(1500),stations:[station]).first?.0 == "visit_gap","Process gaps cannot count as dwell")
    var ambiguous=ResearchVisitDetector()
    let other=ResearchStation(id:"s2",name:"Other",latitude:27.0001,longitude:-82)
    assert(ambiguous.process(fix(1000),stations:[station,other]).first?.1.ambiguousIDs.count == 2)
    let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer{try? FileManager.default.removeItem(at:directory)}
    let store=try DrivingResearchStore(directory:directory)
    let event=try ResearchEvent(kind:"location",payload:["timestamp":1000])
    try store.append(event)
    assert(try! store.counts().pending == 1)
    let reopened=try DrivingResearchStore(directory:directory)
    assert(try! reopened.events(pending:true).first?.id == event.id,"Outbox must survive reopening")
    try reopened.acknowledge([event.id]);try reopened.acknowledge([event.id])
    assert(try! reopened.counts().pending == 0)
    assert(try! reopened.counts().total == 1)
    try reopened.erase();assert(try! reopened.counts().total == 0)
    print("PASS: dwell, drive-by, stale/duplicate/inaccurate fixes, evidence gaps, ambiguity, durable outbox, idempotent acknowledgement, erase")
  }
}
