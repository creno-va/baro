import XCTest

/// Only anonymous, static Home and Guide. Never open directory, login, or private routes.
final class BaroHomeUITests: XCTestCase {
  @MainActor
  private func fullyHittable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.exists, element.isHittable else { return false }
    let frame = element.frame
    let visible = frame.intersection(app.windows.firstMatch.frame)
    return frame.width > 0 && frame.height > 0
      && visible.width >= frame.width * 0.95 && visible.height >= frame.height * 0.95
  }

  @MainActor
  private func reach(_ element: XCUIElement, in app: XCUIApplication) throws -> Int {
    XCTAssertTrue(element.waitForExistence(timeout: 30), "BARO_STATIC_CONTROL_MISSING")
    let scroll = app.scrollViews.firstMatch
    XCTAssertTrue(scroll.exists, "BARO_SCROLL_CONTAINER_MISSING")
    var swipes = 0
    while !fullyHittable(element, in: app) && swipes < 24 {
      if element.frame.maxY < app.windows.firstMatch.frame.midY {
        scroll.swipeDown()
      } else {
        scroll.swipeUp()
      }
      swipes += 1
    }
    XCTAssertTrue(fullyHittable(element, in: app), "BARO_STATIC_CONTROL_NOT_FULLY_HITTABLE")
    return swipes
  }

  @MainActor
  func testLargestFontHomeAndGuide() throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "site.baro.app.preview")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_APP_NOT_FOREGROUND")
    let home = app.staticTexts["내 상황을 차근차근 정리해요."]
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_HOME_MISSING")
    XCTAssertFalse(app.staticTexts["앱을 열 수 없어요"].exists, "BARO_CONFIGURATION_ERROR")
    let guide = app.buttons["이용 안내 보기"]
    let homeSwipes = try reach(guide, in: app)
    XCTAssertGreaterThan(homeSwipes, 0, "BARO_LARGE_FONT_SCROLL_NOT_OBSERVED")
    guide.tap()
    XCTAssertTrue(app.staticTexts["상담 준비는 이렇게 진행돼요."].waitForExistence(timeout: 30), "BARO_GUIDE_MISSING")
    let back = app.buttons["처음으로"]
    let guideSwipes = try reach(back, in: app)
    let featureCopy = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "사건 화면에서 자료를 올리고 처리 내용을 확인하거나")).firstMatch
    XCTAssertTrue(featureCopy.exists, "BARO_GUIDE_FEATURE_COPY_MISSING")
    back.tap()
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_HOME_RETURN_MISSING")
    XCTAssertFalse(app.staticTexts["상담 준비는 이렇게 진행돼요."].exists, "BARO_GUIDE_STILL_VISIBLE")
    let result: [String: Any] = [
      "kind": "ios-anonymous-home-guide-xcuitest",
      "applicationId": "site.baro.app.preview",
      "homeSwipes": homeSwipes,
      "guideSwipes": guideSwipes,
      "homeTitleObserved": true,
      "guideButtonFullyHittable": true,
      "guideTapVerified": true,
      "guideTitleObserved": true,
      "currentFeatureDescriptionObserved": true,
      "returnButtonFullyHittable": true,
      "returnTapVerified": true,
      "homeReturnObserved": true,
      "publicDataNavigation": false,
      "authenticationNavigation": false,
      "privateDataAccess": false
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print("BARO_HOME_UI_RESULT:" + String(decoding: data, as: UTF8.self))
    app.terminate()
  }
}
