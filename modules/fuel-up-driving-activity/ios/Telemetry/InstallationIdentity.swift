import Foundation
import Security
import Network

struct InstallationIdentity: Codable {
  let id: String
  let token: String
  static let service = "com.anthonyh.fuelup.installation-telemetry"
  static func load() throws -> Self {
    let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"installation",kSecReturnData as String:true]
    var item:CFTypeRef?
    let status=SecItemCopyMatching(query as CFDictionary,&item)
    if status == errSecSuccess, let data=item as? Data {return try JSONDecoder().decode(Self.self,from:data)}
    // Locked keychain must not silently create a new identity.
    guard status == errSecItemNotFound else {throw NSError(domain:"InstallationIdentity",code:Int(status),userInfo:[NSLocalizedDescriptionKey:"Unlock your phone once to access research storage."])}
    var bytes=[UInt8](repeating:0,count:32)
    guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else {throw URLError(.unknown)}
    let value=Self(id:UUID().uuidString.lowercased(),token:bytes.map{String(format:"%02x",$0)}.joined())
    let insert:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"installation",kSecValueData as String:try JSONEncoder().encode(value),kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    guard SecItemAdd(insert as CFDictionary,nil)==errSecSuccess else {throw URLError(.cannotCreateFile)}
    return value
  }
  static func erase() throws {
    let status=SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"installation"] as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {throw URLError(.cannotRemoveFile)}
  }
}


