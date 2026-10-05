import Foundation
import Security

struct ResearchIdentity: Codable {
  let id: String
  let token: String
  static let service = "com.anthonyh.fuelup.driving-research"
  static func load() throws -> Self {
    let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"participant",kSecReturnData as String:true]
    var item:CFTypeRef?
    let status=SecItemCopyMatching(query as CFDictionary,&item)
    if status == errSecSuccess, let data=item as? Data {return try JSONDecoder().decode(Self.self,from:data)}
    // Locked keychain must not silently create a new identity.
    guard status == errSecItemNotFound else {throw NSError(domain:"ResearchIdentity",code:Int(status),userInfo:[NSLocalizedDescriptionKey:"Unlock your phone once to access research storage."])}
    var bytes=[UInt8](repeating:0,count:32)
    guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else {throw URLError(.unknown)}
    let value=Self(id:UUID().uuidString.lowercased(),token:bytes.map{String(format:"%02x",$0)}.joined())
    let insert:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"participant",kSecValueData as String:try JSONEncoder().encode(value),kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    guard SecItemAdd(insert as CFDictionary,nil)==errSecSuccess else {throw URLError(.cannotCreateFile)}
    return value
  }
  static func erase() throws {
    let status=SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"participant"] as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {throw URLError(.cannotRemoveFile)}
  }
}

final class DrivingResearchTransport {
  private let endpoint=URL(string:"https://vjindchxfebaltbslqwc.supabase.co/functions/v1/driving-research")!
  private let session:URLSession = {
    let c=URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest=20; c.timeoutIntervalForResource=25
    c.urlCache=nil; c.httpCookieStorage=nil
    return URLSession(configuration:c)
  }()
  func send(_ action:String, identity:ResearchIdentity, fields:[String:Any]=[:], wifiOnly:Bool=false) async throws -> [String:Any] {
    var body=fields;body["action"]=action;body["participantId"]=identity.id
    var request=URLRequest(url:endpoint);request.httpMethod="POST"
    request.setValue("application/json",forHTTPHeaderField:"Content-Type")
    request.setValue(identity.token,forHTTPHeaderField:"x-research-token")
    request.allowsCellularAccess = !wifiOnly
    request.allowsExpensiveNetworkAccess = true
    request.allowsConstrainedNetworkAccess = true
    request.httpBody=try JSONSerialization.data(withJSONObject:body)
    let(data,response)=try await session.data(for:request)
    guard let http=response as? HTTPURLResponse,http.statusCode==200 else {throw URLError(.badServerResponse)}
    guard let result=try JSONSerialization.jsonObject(with:data) as? [String:Any] else {throw URLError(.cannotParseResponse)}
    return result
  }
}
