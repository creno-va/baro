require 'xcodeproj'

raise 'BARO_REFERENCE_OWNED_PROJECT_REQUIRED' unless ARGV.empty? &&
  File.file?('InputReferenceApp.swift') && File.file?('InputReferenceUITests.swift') &&
  !File.exist?('BaroInputReference.xcodeproj')
project = Xcodeproj::Project.new('BaroInputReference.xcodeproj')
app = project.new_target(:application, 'BaroInputReference', :ios, '16.4', nil, :swift)
test = project.new_target(:ui_test_bundle, 'BaroInputReferenceTests', :ios, '16.4', nil, :swift)
app.source_build_phase.add_file_reference(project.main_group.new_file('InputReferenceApp.swift'))
test.source_build_phase.add_file_reference(project.main_group.new_file('InputReferenceUITests.swift'))
test.add_dependency(app)
project.root_object.attributes['TargetAttributes'] = {
  test.uuid => { 'TestTargetID' => app.uuid }
}
[[app, 'site.baro.test.input-reference'], [test, 'site.baro.test.input-reference.tests']].each do |target, identifier|
  target.build_configurations.each do |configuration|
    configuration.build_settings.merge!({
      'PRODUCT_BUNDLE_IDENTIFIER' => identifier,
      'GENERATE_INFOPLIST_FILE' => 'YES',
      'SWIFT_VERSION' => '5.0',
      'TARGETED_DEVICE_FAMILY' => '1,2',
      'CODE_SIGN_ENTITLEMENTS' => 'Runner.entitlements'
    })
    if target == app
      configuration.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES'
      configuration.build_settings['INFOPLIST_KEY_UISupportedInterfaceOrientations'] = 'UIInterfaceOrientationPortrait'
    else
      configuration.build_settings['TEST_TARGET_NAME'] = app.name
    end
  end
end
File.write('Runner.entitlements', <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
  <key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)</string></array>
  </dict></plist>
PLIST
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, test, :launch_target => true)
scheme.save_as(project.path, 'BaroInputReferenceTests', true)
puts "BARO_XCODEPROJ_VERSION:#{Xcodeproj::VERSION}"
