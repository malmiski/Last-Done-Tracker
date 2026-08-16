import UIKit
import Expo
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    excludeEntryImagesFromBackup()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "ActivityTracker",
      in: window,
      launchOptions: launchOptions
    )

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /// Keep entry photos out of iCloud and iTunes backups.
  ///
  /// Entry images are stored as files under `Documents/entry-images`, which iOS
  /// includes in backups by default. For a photo library that can run to
  /// hundreds of megabytes — and that the app can already export as a
  /// self-contained .zip — that is wasted iCloud quota, so the directory is
  /// flagged with `NSURLIsExcludedFromBackupKey`.
  ///
  /// Notes:
  ///  - The flag lives on the directory and covers everything inside it, so it
  ///    does not need to be set per file.
  ///  - It is lost if the directory is deleted and recreated, which is why this
  ///    runs on every launch rather than once. Setting it repeatedly is cheap
  ///    and idempotent.
  ///  - The directory is created here if missing so the flag is in place before
  ///    JavaScript writes the first image.
  ///  - `Documents` (not `Caches`) remains the right home: these files cannot be
  ///    regenerated, and iOS may purge `Caches` under storage pressure.
  ///
  /// There is no expo-file-system API for this, hence the native code.
  private func excludeEntryImagesFromBackup() {
    let fileManager = FileManager.default
    guard let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
      return
    }

    var directory = documents.appendingPathComponent("entry-images", isDirectory: true)

    if !fileManager.fileExists(atPath: directory.path) {
      do {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      } catch {
        NSLog("[ActivityTracker] Could not create entry-images directory: \(error)")
        return
      }
    }

    do {
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
    } catch {
      // Non-fatal: the images still work, they are just included in backups.
      NSLog("[ActivityTracker] Could not exclude entry-images from backup: \(error)")
    }
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
