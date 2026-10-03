import SwiftUI

// One bundled image per brand identity. No URLSession or runtime logo requests.
enum OnboardingAssets {
  static let bundle: Bundle = {
    let owner = Bundle(for: NativeOnboardingView.self)
    guard let url = owner.url(forResource: "FuelUpOnboarding", withExtension: "bundle")
      ?? Bundle.main.url(forResource: "FuelUpOnboarding", withExtension: "bundle"),
      let bundle = Bundle(url: url) else { return owner }
    return bundle
  }()
  static let logos: [String: String] = {
    guard let url = bundle.url(forResource: "brand-logos", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let names = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
    return names
  }()
  static let cache = NSCache<NSString, UIImage>()
  static func image(_ name: String) -> UIImage? {
    if let cached = cache.object(forKey: name as NSString) { return cached }
    let image = UIImage(named: name, in: bundle, compatibleWith: nil)
      ?? bundle.url(forResource: (name as NSString).deletingPathExtension, withExtension: (name as NSString).pathExtension)
        .flatMap { UIImage(contentsOfFile: $0.path) }
    if let image { cache.setObject(image, forKey: name as NSString) }
    return image
  }
  static func brand(_ id: String) -> UIImage? {
    guard let file = logos[id.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)] else { return nil }
    return image(file)
  }
}

struct OnboardingWordmark: View {
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    if let logo = OnboardingAssets.image(scheme == .dark ? "FuelUp-text-logo-dark.png" : "FuelUp-text-logo-light.png") {
      Image(uiImage: logo).resizable().scaledToFit()
        .frame(width: 132, height: 38)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Fuel Up")
        .accessibilityIdentifier("onboarding-wordmark")
    }
  }
}

struct OnboardingRowIcon: View {
  @Environment(\.colorScheme) private var scheme
  let fuel: String?
  let brand: String?
  var body: some View {
    Group {
      if let fuel, let image = OnboardingAssets.image("fuel-\(fuel)\(scheme == .dark ? "-dark" : "")") {
        Image(uiImage: image).resizable().scaledToFit()
      } else if let brand, let image = OnboardingAssets.brand(brand) {
        Image(uiImage: image).resizable().scaledToFit().padding(4)
          .background(.white, in: RoundedRectangle(cornerRadius: 10))
      } else {
        Image(systemName: "fuelpump.fill").font(.system(size: 24)).foregroundStyle(.secondary)
      }
    }.frame(width: 44, height: 44).accessibilityHidden(true)
  }
}
