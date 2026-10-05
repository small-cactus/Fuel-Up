import SwiftUI

// Reuse the fetched brand artwork already shipped with Fuel Up. No tracking URL
// or repeated logo download is needed each time the visit list appears.
struct DrivingResearchStationLogo: View {
  let name:String
  private static let bundle:Bundle? = {
    guard let url=Bundle.main.url(forResource:"FuelUpOnboarding",withExtension:"bundle") else{return nil}
    return Bundle(url:url)
  }()
  private static let logos:[String:String] = {
    guard let url=bundle?.url(forResource:"brand-logos",withExtension:"json"),
          let data=try? Data(contentsOf:url),let names=try? JSONDecoder().decode([String:String].self,from:data) else{return [:]}
    return names
  }()
  private static let cache=NSCache<NSString,UIImage>()
  private var image:UIImage? {
    let key=name.lowercased().trimmingCharacters(in:.whitespacesAndNewlines)
    let match=Self.logos[key] ?? Self.logos.keys.sorted { $0.count>$1.count }.first {key.hasPrefix($0+" ") || key.hasPrefix($0+" #")}.flatMap {Self.logos[$0]}
    guard let file=match,let bundle=Self.bundle else{return nil}
    if let image=Self.cache.object(forKey:file as NSString) {return image}
    let image=UIImage(named:file,in:bundle,compatibleWith:nil)
      ?? bundle.url(forResource:(file as NSString).deletingPathExtension,withExtension:(file as NSString).pathExtension).flatMap {UIImage(contentsOfFile:$0.path)}
    if let image {Self.cache.setObject(image,forKey:file as NSString)}
    return image
  }
  var body:some View {
    Group {
      if let image {Image(uiImage:image).resizable().scaledToFit().padding(5).background(.white,in:.rect(cornerRadius:10))}
      else {Image(systemName:"fuelpump.fill").font(.title2).foregroundStyle(.secondary)}
    }.frame(width:44,height:44).accessibilityHidden(true)
  }
}
