Pod::Spec.new do |s|
  s.name = 'BaroPrivateDownload'
  s.version = '0.1.0'
  s.summary = 'BARO private bounded native download'
  s.description = 'Private native HTTP to disk with explicit credentials and cancellation.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'BARO'
  s.homepage = 'https://github.com/creno-va/baro'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/creno-va/baro.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.resource_bundles = { 'BaroPrivateDownload_privacy' => ['PrivacyInfo.xcprivacy'] }
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
