require 'xcodeproj'

# Run only inside a fresh, owned CI directory. No app target or external account.
raise 'BARO_UI_OWNED_PROJECT_REQUIRED' unless ARGV.empty? &&
  File.file?('HomeUITests.swift') && !File.exist?('BaroHomeUI.xcodeproj')
project = Xcodeproj::Project.new('BaroHomeUI.xcodeproj')
target = project.new_target(:ui_test_bundle, 'BaroHomeUITests', :ios, '16.4', nil, :swift)
target.source_build_phase.add_file_reference(project.main_group.new_file('HomeUITests.swift'))
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'site.baro.test.home',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'CODE_SIGN_ENTITLEMENTS' => 'Runner.entitlements'
  })
end
# Let Xcode resolve its own Simulator prefix; never supply an Apple Team or fake Team setting.
File.write('Runner.entitlements', <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
  <key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)</string></array>
  </dict></plist>
PLIST
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(nil, target)
scheme.save_as(project.path, 'BaroHomeUITests', true)
puts "BARO_XCODEPROJ_VERSION:#{Xcodeproj::VERSION}"
