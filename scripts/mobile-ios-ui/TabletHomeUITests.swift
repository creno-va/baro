import UIKit

// Concatenated with the unchanged phone Home/Guide test and its reach helper.
extension BaroHomeUITests {
  @MainActor
  private func tabletWindow(_ app: XCUIApplication, portrait: Bool) -> Bool {
    let deadline = Date().addingTimeInterval(30)
    repeat {
      let frame = app.windows.firstMatch.frame
      if frame.width.isFinite && frame.height.isFinite && frame.width > 0 && frame.height > 0
        && (portrait ? frame.height > frame.width : frame.width > frame.height) { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    } while Date() < deadline
    return false
  }

  @MainActor
  func testTabletLargestFontHomeGuideAndRotation() throws {
    continueAfterFailure = false
    XCTAssertTrue(UIDevice.current.userInterfaceIdiom == .pad, "BARO_TABLET_IDIOM_MISSING")
    XCUIDevice.shared.orientation = .portrait
    defer { XCUIDevice.shared.orientation = .portrait }
    let app = XCUIApplication(bundleIdentifier: "site.baro.app.preview")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_APP_NOT_FOREGROUND")
    XCTAssertTrue(tabletWindow(app, portrait: true), "BARO_TABLET_PORTRAIT_MISSING")
    let home = app.staticTexts["내 상황을 차근차근 정리해요."]
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_HOME_MISSING")
    XCTAssertFalse(app.staticTexts["앱을 열 수 없어요"].exists, "BARO_CONFIGURATION_ERROR")
    let guide = app.buttons["이용 안내 보기"]
    let homeSwipes = try reach(guide, in: app)
    // A tablet can fit the action without scrolling. reach still requires the
    // actual full control bounds/hittability before the real tap.
    guide.tap()
    XCTAssertTrue(app.staticTexts["상담 준비는 이렇게 진행돼요."].waitForExistence(timeout: 30), "BARO_GUIDE_MISSING")
    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertTrue(tabletWindow(app, portrait: false), "BARO_TABLET_LANDSCAPE_MISSING")
    let back = app.buttons["처음으로"]
    let guideSwipes = try reach(back, in: app)
    let featureCopy = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "사건 화면에서 자료를 올리고 처리 내용을 확인하거나")).firstMatch
    XCTAssertTrue(featureCopy.exists, "BARO_GUIDE_FEATURE_COPY_MISSING")
    back.tap()
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_HOME_RETURN_MISSING")
    XCTAssertFalse(app.staticTexts["상담 준비는 이렇게 진행돼요."].exists, "BARO_GUIDE_STILL_VISIBLE")
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(tabletWindow(app, portrait: true), "BARO_TABLET_PORTRAIT_MISSING")
    let portraitHomeSwipes = try reach(guide, in: app)
    let result: [String: Any] = [
      "kind": "ios-anonymous-tablet-home-guide-rotation-xcuitest", "applicationId": "site.baro.app.preview",
      "homeSwipes": homeSwipes, "guideSwipes": guideSwipes, "portraitHomeSwipes": portraitHomeSwipes,
      "homeTitleObserved": true, "guideButtonFullyHittable": true, "guideTapVerified": true,
      "guideTitleObserved": true, "currentFeatureDescriptionObserved": true,
      "returnButtonFullyHittable": true, "returnTapVerified": true, "homeReturnObserved": true,
      "tabletIdiomObserved": true, "landscapeGuideWindowObserved": true,
      "landscapeReturnControlFullyHittable": true, "portraitHomeWindowObserved": true,
      "portraitGuideControlFullyHittable": true,
      "publicDataNavigation": false, "authenticationNavigation": false, "privateDataAccess": false
    ]
    print("BARO_HOME_UI_RESULT:" + String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
    app.terminate()
  }
}
