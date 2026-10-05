import Foundation

@main struct NotificationTestTests {
  static func main() throws {
    let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer {try? FileManager.default.removeItem(at:folder)}
    let url=folder.appendingPathComponent("tests.json"),store=DrivingResearchTestStore(url:url)
    let id=UUID().uuidString.lowercased(),other=UUID().uuidString.lowercased()
    let fixture=ResearchNotificationTest(id:id,stationName:"Shell",candidate:true,createdAt:100,expiresAt:1000,status:"queued")
    assert(fixture.title==ResearchConfirmation.notificationTitle(candidate:true,stationName:"Shell"))
    let stop=ResearchNotificationTest(id:other,stationName:"Shell",candidate:false,createdAt:100,expiresAt:1000,status:"queued")
    assert(stop.title==ResearchConfirmation.notificationTitle(candidate:false,stationName:"Shell"))
    try store.reconcile([fixture,stop],now:200)
    assert(tryValue {try store.all().count}==2)
    assert(tryValue {try store.answer(id,label:"fueled",now:210)})
    let reopened=DrivingResearchTestStore(url:url)
    let sent=try reopened.all().first{$0.id==id}!
    assert(sent.label=="fueled" && sent.dirty==true,"Cold notification answers are durable")
    assert(!tryValue {try store.answer(id,label:nil,now:220)},"Dismissal cannot erase an answer")
    assert(!tryValue {try store.answer(other,label:"invented",now:220)})
    assert(tryValue {try store.answer(id,label:"not_fueling",now:230)})
    try store.acknowledge(sent)
    assert(tryValue {try store.all().first{$0.id==id}!.dirty}==true,"An old response cannot acknowledge a newer edit")
    try store.reconcile([fixture,stop],now:240)
    assert(tryValue {try store.all().first{$0.id==id}!.label}=="not_fueling","Old server snapshot preserves offline answer")
    let latest=try store.all().first{$0.id==id}!
    try store.acknowledge(latest)
    assert(tryValue {try store.all().first{$0.id==id}!.dirty}==false)
    let removed=try store.reconcile([stop],now:250)
    assert(removed==[id])
    assert(!tryValue {try store.answer(id,label:"fueled",now:260)},"Deleted test cannot be recreated by a late notification action")
    var push=fixture;push.delivery="apns"
    assert(!tryValue {try store.receivePush(push,now:270)},"Deleted APNs fixture cannot return from an old banner")
    assert(!tryValue {try store.answer(other,label:"fueled",now:1001)},"Expired tests cannot be answered")
    assert(tryValue {try store.reconcile([stop],now:1001)}==[other])
    assert(tryValue {try store.all().isEmpty})
    let fresh=ResearchNotificationTest(id:UUID().uuidString,stationName:"Mobil",candidate:true,createdAt:2000,expiresAt:3000,status:"queued",delivery:"apns")
    assert(tryValue {try store.receivePush(fresh,now:2100)})
    assert(tryValue {try store.answer(fresh.id,label:"fueled",now:2101)})
    assert(tryValue {try store.receivePush(fresh,now:2102)})
    assert(tryValue {try store.all().first!.label}=="fueled","Duplicate push preserves cold answer")
    let extra=ResearchNotificationTest(id:UUID().uuidString,stationName:"Shell",candidate:false,createdAt:2000,expiresAt:3000,status:"queued",delivery:"apns")
    assert(tryValue {try store.receivePush(extra,now:2103)})
    assert(tryValue {try store.all().count}==2,"Push merges without clearing other tests")
    assert(!tryValue {try store.receivePush(extra,now:3001)})
    print("PASS: matching copy, durable answers, update races, isolated test deletion, expiration")
  }
  static func tryValue<T>(_ block:() throws -> T) -> T {try! block()}
}
