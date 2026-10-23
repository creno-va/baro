import XCTest

/// Fresh owned Simulator only. Never enter account data or press provider submit/consent controls.
final class BaroAuthCancelUITests: XCTestCase {
  private let providers = [("google", "Google로 로그인"), ("naver", "네이버로 로그인"), ("kakao", "카카오로 로그인")]

  private func stage(_ provider: String, _ value: String) {
    print("BARO_AUTH_CANCEL_STAGE:{\"provider\":\"" + provider + "\",\"stage\":\"" + value + "\"}")
  }

  @MainActor
  private func fullyHittable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.exists, element.isHittable else { return false }
    let frame = element.frame, intersection = frame.intersection(app.windows.firstMatch.frame)
    return frame.width > 0 && frame.height > 0
      && intersection.width >= frame.width * 0.95 && intersection.height >= frame.height * 0.95
  }

  private let dismissLabels = [("cancel", "Cancel"), ("done", "Done"), ("close", "Close")]
  private struct DismissSelection { let element: XCUIElement; let frameExcluded: Bool }
  private struct CancelOwnership {
    var traversalComplete = false
    var webViewObserved = false
    var nativeCancelCount = 0
    var queriedControlMatched = false
    var webViewAncestorExcluded = false
    var keyboardAncestorExcluded = false
  }

  @MainActor
  private func browserWebFrames(_ app: XCUIApplication) -> [CGRect]? {
    guard app.state == .runningForeground, app.windows.firstMatch.exists else { return nil }
    let window = app.windows.firstMatch.frame
    guard window.width > 0 && window.height > 0 else { return nil }
    let webViews = app.webViews
    guard webViews.count > 0 && webViews.count <= 8 else { return nil }
    var frames: [CGRect] = []
    for web in webViews.allElementsBoundByIndex {
      let frame = web.frame, visible = frame.intersection(window)
      guard frame.minX.isFinite && frame.minY.isFinite && frame.width.isFinite && frame.height.isFinite,
        frame.width > 0 && frame.height > 0,
        visible.width >= frame.width * 0.95 && visible.height >= frame.height * 0.95 else { return nil }
      frames.append(frame)
    }
    return frames
  }

  @MainActor
  private func outsideEveryWebView(_ element: XCUIElement, frames: [CGRect]?) -> Bool {
    guard let frames, !frames.isEmpty else { return false }
    let frame = element.frame
    guard frame.minX.isFinite && frame.minY.isFinite && frame.width.isFinite && frame.height.isFinite,
      frame.width > 0 && frame.height > 0 else { return false }
    return frames.allSatisfy {
      let overlap = frame.intersection($0)
      return overlap.isNull || overlap.width <= 0 || overlap.height <= 0
    }
  }

  @MainActor
  private func cancelOwnership(_ app: XCUIApplication) -> CancelOwnership {
    var result = CancelOwnership()
    guard let root = try? app.snapshot() else { return result }
    var visited = 0
    var nativeFrames: [CGRect] = []
    // Snapshot values/hierarchy remain in process memory only. Never print/attach them.
    @MainActor
    func walk(_ node: any XCUIElementSnapshot, webAncestor: Bool, keyboardAncestor: Bool, depth: Int) -> Bool {
      visited += 1
      guard visited <= 20000 && depth <= 128 else { return false }
      let inWeb = webAncestor || node.elementType == .webView
      let inKeyboard = keyboardAncestor || node.elementType == .keyboard
      if node.elementType == .webView { result.webViewObserved = true }
      // Exclude entire rejected branches without inspecting their labels/values.
      if inWeb || inKeyboard { return true }
      guard node.children.count <= 5000 else { return false }
      if node.elementType == .button && node.label == "Cancel" {
        nativeFrames.append(node.frame)
        guard nativeFrames.count <= 256 else { return false }
      }
      for child in node.children {
        if !walk(child, webAncestor: inWeb, keyboardAncestor: inKeyboard, depth: depth + 1) { return false }
      }
      return true
    }
    guard walk(root, webAncestor: false, keyboardAncestor: false, depth: 0) else { return CancelOwnership() }
    result.traversalComplete = true
    result.nativeCancelCount = nativeFrames.count
    let matches = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel"))
    guard result.webViewObserved && matches.count == 1 && nativeFrames.count == 1, let native = nativeFrames.first else { return result }
    let frame = matches.firstMatch.frame
    guard abs(frame.minX - native.minX) <= 0.5 && abs(frame.minY - native.minY) <= 0.5
      && abs(frame.width - native.width) <= 0.5 && abs(frame.height - native.height) <= 0.5 else { return result }
    result.queriedControlMatched = true
    result.webViewAncestorExcluded = true
    result.keyboardAncestorExcluded = true
    return result
  }

  @MainActor
  private func nativeDismiss(_ app: XCUIApplication, absentBefore: Set<String>) -> DismissSelection? {
    guard absentBefore.contains("cancel"), let webFrames = browserWebFrames(app) else { return nil }
    let matches = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel"))
    guard matches.count == 1, fullyHittable(matches.firstMatch, in: app) else { return nil }
    let ownership = cancelOwnership(app)
    guard ownership.traversalComplete && ownership.webViewObserved && ownership.nativeCancelCount == 1
      && ownership.queriedControlMatched && ownership.webViewAncestorExcluded && ownership.keyboardAncestorExcluded else { return nil }
    return DismissSelection(element: matches.firstMatch, frameExcluded: outsideEveryWebView(matches.firstMatch, frames: webFrames))
  }

  @MainActor
  private func reportStatus(_ provider: String, app: XCUIApplication, absentBefore: Set<String>) throws {
    var candidates: [[String: Any]] = []
    let frames = browserWebFrames(app)
    let ownership = cancelOwnership(app)
    // Fixed counts/booleans only. Never export frames, labels, hierarchy or provider page text.
    for (scope, buttons) in [("navigation-bar", app.navigationBars.buttons), ("toolbar", app.toolbars.buttons), ("application", app.buttons)] {
      for (control, label) in dismissLabels {
        let matches = buttons.matching(NSPredicate(format: "label == %@", label)), count = matches.count
        let unique = count == 1
        candidates.append(["control": control, "scope": scope, "count": count,
          "uniqueFullyHittable": unique && fullyHittable(matches.firstMatch, in: app),
          "outsideWebContent": unique && outsideEveryWebView(matches.firstMatch, frames: frames),
          "absentBeforeAuthentication": absentBefore.contains(control)])
      }
    }
    let status: [String: Any] = [
      "provider": provider, "systemWebViewVisible": app.webViews.firstMatch.exists,
      "dismissCandidates": candidates, "browserWindowGeometryVerified": frames != nil,
      "cancelOwnership": ["traversalComplete": ownership.traversalComplete,
        "webViewObserved": ownership.webViewObserved, "nativeCancelCount": ownership.nativeCancelCount,
        "queriedControlMatched": ownership.queriedControlMatched,
        "webViewAncestorExcluded": ownership.webViewAncestorExcluded,
        "keyboardAncestorExcluded": ownership.keyboardAncestorExcluded],
      "authorizingVisible": app.staticTexts["로그인을 확인하고 있어요"].exists,
      "startUnavailableVisible": app.staticTexts["로그인을 시작하지 못했어요. 다시 시도해 주세요."].exists,
      "retryVisible": app.buttons["이용 상태 다시 확인"].exists,
      "appForeground": app.state == .runningForeground
    ]
    let data = try JSONSerialization.data(withJSONObject: status, options: [.sortedKeys])
    print("BARO_AUTH_CANCEL_STATUS:" + String(decoding: data, as: UTF8.self))
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
      var absentBefore: Set<String> = []
      for (control, label) in dismissLabels {
        if app.buttons.matching(NSPredicate(format: "label == %@", label)).count == 0 {
          absentBefore.insert(control)
        }
      }
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
      if !browser.exists { try reportStatus(provider, app: app, absentBefore: absentBefore) }
      XCTAssertTrue(browser.exists, "BARO_AUTH_SYSTEM_WEBVIEW_MISSING")
      stage(provider, "browser-presented")
      var dismissal = nativeDismiss(app, absentBefore: absentBefore)
      for _ in 0..<10 {
        if dismissal != nil { break }
        Thread.sleep(forTimeInterval: 0.5)
        dismissal = nativeDismiss(app, absentBefore: absentBefore)
      }
      if dismissal == nil { try reportStatus(provider, app: app, absentBefore: absentBefore) }
      XCTAssertNotNil(dismissal, "BARO_AUTH_SYSTEM_DISMISS_MISSING")
      guard let dismissal else { return }
      dismissal.element.tap()
      stage(provider, "cancel-tapped")
      let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: browser)
      XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 30), .completed, "BARO_AUTH_WEBVIEW_NOT_DISMISSED")
      XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_AUTH_APP_NOT_FOREGROUND")
      anonymous(app)
      stage(provider, "anonymous-returned")
      results.append([
        "provider": provider, "initialAnonymousObserved": true,
        "osPromptHandled": permissionHandled, "systemWebViewObserved": true,
        "dismissButtonHittable": true, "systemDismissTapped": true,
        "dismissControl": "cancel", "dismissScope": "snapshot-native-window",
        "nativeDismissControlVerified": true, "webContentExcluded": true,
        "webViewFrameExcluded": dismissal.frameExcluded, "dismissControlAbsentBeforeAuthentication": true,
        "snapshotTraversalComplete": true, "snapshotControlMatched": true,
        "webViewAncestorExcluded": true, "keyboardAncestorExcluded": true,
        "browserWindowGeometryVerified": true,
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
