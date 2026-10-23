import XCTest

/// Fresh owned Simulator only. Never enter account data or press provider submit/consent controls.
final class BaroAuthCancelUITests: XCTestCase {
  private let providers = [("google", "Google로 로그인"), ("naver", "네이버로 로그인"), ("kakao", "카카오로 로그인")]

  private func stage(_ provider: String, _ value: String) {
    print("BARO_AUTH_CANCEL_STAGE:{\"provider\":\"" + provider + "\",\"stage\":\"" + value + "\"}")
  }

  @MainActor
  private func reach(_ element: XCUIElement, in app: XCUIApplication) throws {
    XCTAssertTrue(element.waitForExistence(timeout: 30), "BARO_AUTH_CONTROL_MISSING")
    let scroll = app.scrollViews.firstMatch
    var swipes = 0
    @MainActor func visible() -> Bool {
      guard element.exists, element.isHittable else { return false }
      let frame = element.frame, intersection = frame.intersection(app.windows.firstMatch.frame)
      return frame.width > 0 && frame.height > 0
        && intersection.width >= frame.width * 0.95 && intersection.height >= frame.height * 0.95
    }
    while !visible() && swipes < 24 {
      XCTAssertTrue(scroll.exists, "BARO_AUTH_SCROLL_MISSING")
      if element.frame.maxY < app.windows.firstMatch.frame.midY { scroll.swipeDown() }
      else { scroll.swipeUp() }
      swipes += 1
    }
    XCTAssertTrue(visible(), "BARO_AUTH_CONTROL_NOT_HITTABLE")
  }

  @MainActor
  private func anonymous(_ app: XCUIApplication) {
    XCTAssertTrue(app.staticTexts["이용 유형을 선택해 주세요."].waitForExistence(timeout: 30), "BARO_AUTH_ANONYMOUS_MISSING")
    XCTAssertTrue(app.buttons["Google로 로그인"].exists, "BARO_AUTH_PROVIDERS_MISSING")
    XCTAssertTrue(app.buttons["네이버로 로그인"].exists, "BARO_AUTH_PROVIDERS_MISSING")
    XCTAssertTrue(app.buttons["카카오로 로그인"].exists, "BARO_AUTH_PROVIDERS_MISSING")
    XCTAssertFalse(app.buttons["이용 상태 다시 확인"].exists, "BARO_AUTH_ERROR_STATE")
    XCTAssertFalse(app.staticTexts["시작 전에 확인해 주세요"].exists, "BARO_AUTH_UNEXPECTED_CONSENT")
    XCTAssertFalse(app.staticTexts["내 계정"].exists, "BARO_AUTH_UNEXPECTED_SESSION")
    XCTAssertFalse(app.staticTexts["로그인을 확인하고 있어요"].exists, "BARO_AUTH_STILL_AUTHORIZING")
  }

  @MainActor
  private func openSession(_ app: XCUIApplication) throws {
    XCTAssertTrue(app.staticTexts["내 상황을 차근차근 정리해요."].waitForExistence(timeout: 30), "BARO_AUTH_HOME_MISSING")
    let account = app.buttons["로그인·내 계정"]
    try reach(account, in: app)
    account.tap()
    anonymous(app)
  }

  @MainActor
  func testAnonymousProviderBrowserCancellation() throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "site.baro.app.preview")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_AUTH_APP_NOT_FOREGROUND")
    try openSession(app)
    var results: [[String: Any]] = []
    for (provider, label) in providers {
      anonymous(app)
      let signIn = app.buttons[label]
      try reach(signIn, in: app)
      stage(provider, "provider-ready")
      signIn.tap()
      stage(provider, "provider-tapped")
      var permissionHandled = false
      let browser = app.webViews.firstMatch
      for _ in 0..<30 {
        // Only proceed through the OS prompt for our known domain. No account controls.
        for host in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
          let alert = host.alerts.firstMatch
          if alert.exists {
            let knownDomain = alert.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "baro.site")).firstMatch.exists
            let proceed = alert.buttons["Continue"]
            XCTAssertTrue(knownDomain && proceed.exists && !permissionHandled, "BARO_AUTH_OS_PROMPT_UNRECOGNIZED")
            proceed.tap()
            permissionHandled = true
          }
        }
        if browser.waitForExistence(timeout: 1) { break }
      }
      if !browser.exists {
        let status: [String: Any] = [
          "provider": provider, "systemWebViewVisible": false,
          "systemCancelVisible": app.buttons["Cancel"].exists,
          "authorizingVisible": app.staticTexts["로그인을 확인하고 있어요"].exists,
          "startUnavailableVisible": app.staticTexts["로그인을 시작하지 못했어요. 다시 시도해 주세요."].exists,
          "retryVisible": app.buttons["이용 상태 다시 확인"].exists,
          "appForeground": app.state == .runningForeground
        ]
        let statusData = try JSONSerialization.data(withJSONObject: status, options: [.sortedKeys])
        print("BARO_AUTH_CANCEL_STATUS:" + String(decoding: statusData, as: UTF8.self))
      }
      XCTAssertTrue(browser.exists, "BARO_AUTH_SYSTEM_WEBVIEW_MISSING")
      let cancel = app.buttons["Cancel"]
      XCTAssertTrue(cancel.waitForExistence(timeout: 10) && cancel.isHittable, "BARO_AUTH_SYSTEM_CANCEL_MISSING")
      stage(provider, "browser-presented")
      cancel.tap()
      stage(provider, "cancel-tapped")
      let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: browser)
      XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 30), .completed, "BARO_AUTH_WEBVIEW_NOT_DISMISSED")
      XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_AUTH_APP_NOT_FOREGROUND")
      anonymous(app)
      stage(provider, "anonymous-returned")
      results.append([
        "provider": provider, "initialAnonymousObserved": true,
        "osPromptHandled": permissionHandled, "systemWebViewObserved": true,
        "cancelButtonHittable": true, "systemCancelTapped": true,
        "webViewDismissed": true, "anonymousReturnObserved": true,
        "errorStateAbsent": true, "consentStateAbsent": true
      ])
    }
    stage("kakao", "cold-restart")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_AUTH_APP_NOT_FOREGROUND")
    try openSession(app)
    let result: [String: Any] = [
      "kind": "ios-anonymous-provider-browser-cancellation",
      "applicationId": "site.baro.app.preview", "providers": results,
      "coldAnonymousReturnObserved": true, "accountLoginPerformed": false,
      "credentialsEntered": false, "callbackExchangeVerified": false,
      "providerAcceptanceVerified": false, "privateDataAccess": false,
      "publicDataNavigation": false, "authenticationNavigation": true
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print("BARO_AUTH_CANCEL_RESULT:" + String(decoding: data, as: UTF8.self))
    app.terminate()
  }
}
