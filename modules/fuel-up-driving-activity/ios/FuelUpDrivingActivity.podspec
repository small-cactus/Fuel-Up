require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'FuelUpDrivingActivity'
  s.version          = package['version']
  s.summary          = package['description']
  s.description      = package['description']
  s.license          = package['license']
  s.author           = package['author']
  s.homepage         = 'https://fuelup.local'
  s.platforms        = {
    :ios => '26.0',
    :tvos => '15.1'
  }
  s.swift_version    = '5.9'
  s.static_framework = true
  s.source           = { :path => '.' }

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoNotifications'
  s.frameworks = 'CoreMotion', 'CoreLocation', 'Security', 'UserNotifications', 'BackgroundTasks'
  s.libraries = 'sqlite3'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.resource_bundles = {'FuelUpResearch' => ['Resources/*.png', 'Resources/*.xcassets']}
  s.source_files = '**/*.{h,m,swift}'
end
