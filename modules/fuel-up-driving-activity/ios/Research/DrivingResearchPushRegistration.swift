import Foundation
import UIKit
import UserNotifications
import CryptoKit

@MainActor
final class DrivingResearchPushRegistration {
  static let shared=DrivingResearchPushRegistration()
  private let transport=DrivingResearchTransport()
  private var registration:Task<Void,Never>?
  private var lastAttempt=Date.distantPast
  private var uploading=false
  private var token:String?

  func registerIfAllowed() {
    guard UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey),registration == nil,
      Date().timeIntervalSince(lastAttempt)>60 else{return}
    lastAttempt=Date()
    registration=Task {
      defer{registration=nil}
      let settings=await UNUserNotificationCenter.current().notificationSettings()
      guard [.authorized,.provisional,.ephemeral].contains(settings.authorizationStatus) else{return}
      // Register on each launch. Apple can rotate a device token at any time.
      UIApplication.shared.registerForRemoteNotifications()
      await upload()
    }
  }
  func registered(_ data:Data) {
    token=data.map{String(format:"%02x",$0)}.joined()
    Task {await upload()}
  }
  func failed() {lastAttempt = .distantPast}
  func erase() {
    token=nil;UserDefaults.standard.removeObject(forKey:"research.apnsRegistration")
  }
  private func upload() async {
    guard !uploading,UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey),let token,
      let environment=Self.environment() else{return}
    uploading=true;defer{uploading=false}
    do {
      let identity=try ResearchIdentity.load()
      let fingerprint=SHA256.hash(data:Data((identity.id+environment+token).utf8)).map{String(format:"%02x",$0)}.joined()
      guard UserDefaults.standard.string(forKey:"research.apnsRegistration") != fingerprint else{return}
      let response=try await transport.send("registerPush",identity:identity,fields:["deviceToken":token,"environment":environment])
      if response["registered"] as? Bool == true,UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey) {
        UserDefaults.standard.set(fingerprint,forKey:"research.apnsRegistration")
      }
    } catch { /* Retry on the next native foreground/connectivity wake. */ }
  }
  static func environment()->String? {
    // Development/ad-hoc builds carry their signed entitlement in the profile.
    // App Store/TestFlight apps have no embedded profile and use production APNs.
    guard let url=Bundle.main.url(forResource:"embedded",withExtension:"mobileprovision") else{return "production"}
    guard let data=try? Data(contentsOf:url),
      let start=data.range(of:Data("<?xml".utf8)),let end=data.range(of:Data("</plist>".utf8)),
      let plist=try? PropertyListSerialization.propertyList(from:data.subdata(in:start.lowerBound..<end.upperBound),options:[],format:nil) as? [String:Any],
      let entitlements=plist["Entitlements"] as? [String:Any],let value=entitlements["aps-environment"] as? String else{return nil}
    return value == "development" ? "sandbox" : value == "production" ? "production" : nil
  }
}
