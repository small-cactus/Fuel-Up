// SDK 55 scene adapter for apps built with the iOS 27 SDK.
// Keep Expo subscribers and React Native's initial-link handling intact.
@objc(FuelUpSceneDelegate)
class FuelUpSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let delegate = appDelegate,
          let factory = delegate.reactNativeFactory else { return }

    var launchOptions = delegate.pendingSceneLaunchOptions ?? [:]
    if let context = options.urlContexts.first {
      launchOptions[.url] = context.url
      launchOptions[.sourceApplication] = context.options.sourceApplication
    }
    if let activity = options.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity
      ]
    }
    if let response = options.notificationResponse {
      launchOptions[.remoteNotification] = response.notification.request.content.userInfo
    }

    let sceneWindow = UIWindow(windowScene: windowScene)
    window = sceneWindow
    if let root = delegate.window?.rootViewController {
      delegate.window?.rootViewController = nil
      sceneWindow.rootViewController = root
      sceneWindow.makeKeyAndVisible()
    } else {
      delegate.window = sceneWindow
      factory.startReactNative(withModuleName: "main", in: sceneWindow, launchOptions: launchOptions)
    }
    delegate.window = sceneWindow
    delegate.pendingSceneLaunchOptions = nil
    if let shortcut = options.shortcutItem {
      delegate.application(UIApplication.shared, performActionFor: shortcut, completionHandler: { _ in })
    }
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }
  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }
  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }
  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
  func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                   completionHandler: @escaping (Bool) -> Void) {
    guard let delegate = appDelegate else { completionHandler(false); return }
    delegate.application(UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
  }
}
