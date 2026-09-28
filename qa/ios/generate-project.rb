require 'xcodeproj'
require 'fileutils'
root = File.expand_path(__dir__)
output = ENV.fetch('FUEL_QA_PROJECT', '/tmp/FuelUpUITests')
FileUtils.mkdir_p(output)
project = Xcodeproj::Project.new(File.join(output, 'FuelUpQA.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'FuelUpQA', :ios, '16.0')
target.add_file_references([project.main_group.new_file(File.join(root, 'FuelUpQATests.swift'))])
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.anthonyh.fuelup.qa',
    'GENERATE_INFOPLIST_FILE' => 'YES', 'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1', 'CODE_SIGNING_ALLOWED' => 'NO',
    'SDKROOT' => 'iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET' => '16.0'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'FuelUpQA', true)
puts project.path
