import Foundation

@main struct ResearchTests {
  static func main() throws {
    for count in 0..<500 {
      assert(!ResearchTransferPolicy.canUpload(online:true,wifi:true,pending:count))
    }
    assert(ResearchTransferPolicy.canUpload(online:true,wifi:true,pending:500))
    assert(ResearchTransferPolicy.canUpload(online:true,wifi:true,pending:1500))
    assert(ResearchTransferPolicy.canUpload(online:true,wifi:true,pending:1,draining:true))
    assert(!ResearchTransferPolicy.canUpload(online:true,wifi:false,pending:1500))
    assert(!ResearchTransferPolicy.canUpload(online:true,wifi:false,pending:1,draining:true))
    assert(ResearchTransferPolicy.canUpload(online:true,wifi:false,pending:1,manual:true))
    assert(!ResearchTransferPolicy.canUpload(online:false,wifi:false,pending:1500,manual:true))
    assert(ResearchTransferPolicy.countReportDue(now:21600,lastReport:0))
    assert(!ResearchTransferPolicy.countReportDue(now:21599,lastReport:0))
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
    var brief=ambiguous.active!
    brief.lastInsideAt=brief.startedAt+45;brief.samples=3
    assert(ResearchConfirmation.notificationTitle(for:brief) == "got something at Test Station? 👀")
    assert(ResearchConfirmation.shouldPrompt(event:"visit_departure",visit:brief))
    assert(!ResearchConfirmation.shouldPrompt(event:"visit_gap",visit:brief))
    brief.lastInsideAt=brief.startedAt+10
    assert(!ResearchConfirmation.shouldPrompt(event:"visit_departure",visit:brief))
    brief.candidate=true
    assert(ResearchConfirmation.notificationTitle(for:brief) == "got fuel? 👀")
    assert(ResearchConfirmation.shouldPrompt(event:"visit_candidate",visit:brief))
    assert(!ResearchConfirmation.shouldPrompt(event:"visit_departure",visit:brief))
    assert(ResearchConfirmation.notificationSubtitle == "help Fuel Up get better. Tap and hold to answer")
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
    let visit=ambiguous.active!
    try reopened.append(ResearchEvent(kind:"visit_prompt",payload:["visitId":visit.id,"status":"created","confirmationState":"unconfirmed"]))
    try reopened.append(ResearchEvent(kind:"visit_prompt",payload:["visitId":visit.id,"status":"dismissed","confirmationState":"unconfirmed"]))
    let unconfirmed=ResearchConfirmation.state(try reopened.confirmationRecords())
    assert(unconfirmed.prompted.contains(visit.id))
    assert(unconfirmed.labels[visit.id] == nil,"Ignoring or dismissing is not a negative label")
    assert(ResearchConfirmation.title(for:nil) == "Unconfirmed")
    assert(ResearchConfirmation.label(for:"dismiss") == nil)
    for label in ["fueled","not_fueling","not_a_stop"] {
      let payload=ResearchConfirmation.payload(visit:visit,label:label,source:"notification")!
      assert(payload["confirmationState"] as? String == "answered")
      try reopened.append(ResearchEvent(kind:"visit_label",payload:payload))
    }
    let afterRestart=try DrivingResearchStore(directory:directory)
    assert(ResearchConfirmation.state(try! afterRestart.confirmationRecords()).labels[visit.id] == "not_a_stop")
    assert(ResearchConfirmation.payload(visit:visit,label:"auto_fueled",source:"app") == nil)
    try reopened.erase();assert(try! reopened.counts().total == 0)
    print("PASS: dwell, drive-by, stale/duplicate/inaccurate fixes, evidence gaps, ambiguity, durable outbox, idempotent acknowledgement, erase")
  }
}
