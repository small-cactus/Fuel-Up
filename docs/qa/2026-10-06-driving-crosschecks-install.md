# Driving research cross-checks: physical installation

- Installed source: master `5784811`, including stop policy `station-stop-v2` and cross-check collection version 1.
- Target discovered live: Anthony’s iPhone 18 Pro Max, available and paired. The older iPhone was not selected.
- Signed Release build succeeded; the build script verified the deep signature and expected `com.anthonyh.fuelup` bundle identifier before installation.
- Installed in place with `devicectl`; no uninstall or data-clearing command was used.
- Device read-back confirmed Fuel Up, version 1.0.0, local bundle version 23. This direct development installation contains newer native source than the previously uploaded TestFlight 23; TestFlight itself was not updated by this installation.
- Built Info.plist confirms the updated Motion & Fitness explanation covering driving, walking, and step activity.
- The phone app was not opened. Real step/visit delivery and subsequent device uploads require opening the updated app and future station visits; installation does not establish those outcomes.
- Build/install log: `/tmp/fuel-crosschecks-device-install.log`. App artifact: `/tmp/FuelUpGlassDevice/Build/Products/Release-iphoneos/FuelUp.app`. Generated files are not committed.
