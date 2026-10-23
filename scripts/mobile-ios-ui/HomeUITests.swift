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
    try homeAndGuide(audit: false)
  }

  @MainActor
  func testLargestFontHomeAndGuideAccessibility() throws {
    guard #available(iOS 17.0, *) else {
      XCTFail("BARO_AUDIT_OS_UNSUPPORTED")
      return
    }
    try homeAndGuide(audit: true)
  }

  @MainActor
  private func homeAndGuide(audit: Bool) throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "site.baro.app.preview")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_APP_NOT_FOREGROUND")
    let home = app.staticTexts["내 상황을 차근차근 정리해요."]
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_HOME_MISSING")
    XCTAssertFalse(app.staticTexts["앱을 열 수 없어요"].exists, "BARO_CONFIGURATION_ERROR")
    var audits: [[String: Any]] = []
    if audit { audits.append(try auditViewport("home-initial", app: app)) }
    let guide = app.buttons["이용 안내 보기"]
    let homeSwipes = try reach(guide, in: app)
    // OS audits can inspect/change the viewport. The separate ordinary journey
    // remains responsible for proving user scrolling without audit side effects.
    if !audit { XCTAssertGreaterThan(homeSwipes, 0, "BARO_LARGE_FONT_SCROLL_NOT_OBSERVED") }
    if audit { audits.append(try auditViewport("home-action", app: app)) }
    guide.tap()
    XCTAssertTrue(app.staticTexts["상담 준비는 이렇게 진행돼요."].waitForExistence(timeout: 30), "BARO_GUIDE_MISSING")
    if audit { audits.append(try auditViewport("guide-initial", app: app)) }
    let back = app.buttons["처음으로"]
    let guideSwipes = try reach(back, in: app)
    let featureCopy = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "사건 화면에서 자료를 올리고 처리 내용을 확인하거나")).firstMatch
    XCTAssertTrue(featureCopy.exists, "BARO_GUIDE_FEATURE_COPY_MISSING")
    if audit { audits.append(try auditViewport("guide-action", app: app)) }
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
    if !audit { print("BARO_HOME_UI_RESULT:" + String(decoding: data, as: UTF8.self)) }
    if audit {
      let issueCount = audits.reduce(0) { $0 + ($1["issueCount"] as? Int ?? 0) }
      let observation: [String: Any] = [
        "kind": "ios-anonymous-home-guide-accessibility-audit",
        "applicationId": "site.baro.app.preview",
        "requestedAuditTypes": ["contrast", "dynamic-type", "element-detection", "hit-region", "element-description", "text-clipped", "trait"],
        "viewports": audits,
        "issueCount": issueCount,
        "auditPassed": issueCount == 0,
        "defaultIssueReportingReplacedByFixedCounts": true,
        "unreportedIssueCount": 0,
        "voiceOverVerified": false,
        "publicDataNavigation": false,
        "authenticationNavigation": false,
        "privateDataAccess": false
      ]
      let auditData = try JSONSerialization.data(withJSONObject: observation, options: [.sortedKeys])
      print("BARO_HOME_ACCESSIBILITY_RESULT:" + String(decoding: auditData, as: UTF8.self))
    }
    app.terminate()
  }

  private enum AuditFailure: Error { case unsupported, executionFailed }

  @MainActor
  private func auditViewport(_ viewport: String, app: XCUIApplication) throws -> [String: Any] {
    guard #available(iOS 17.0, *) else { throw AuditFailure.unsupported }
    let types: [(String, XCUIAccessibilityAuditType)] = [
      ("contrast", .contrast), ("dynamic-type", .dynamicType),
      ("element-detection", .elementDetection), ("hit-region", .hitRegion),
      ("element-description", .sufficientElementDescription), ("text-clipped", .textClipped),
      ("trait", .trait)
    ]
    var findings: [String: Int] = [:]
    var count = 0
    do {
      try app.performAccessibilityAudit(for: types.reduce(XCUIAccessibilityAuditType()) { $0.union($1.1) }) { issue in
        count += 1
        let category = types.first(where: { issue.auditType.contains($0.1) })?.0 ?? "other"
        let element = issue.element
        let targets = [
          "내 상황을 차근차근 정리해요.": "home-title",
          "상담 준비는 이렇게 진행돼요.": "guide-title",
          "이용 안내 보기": "guide-button", "처음으로": "return-button",
          "변호사 탐색": "browse-button", "로그인·내 계정": "account-button",
          "내 사건 정리": "cases-button"
        ]
        let target = targets[element?.label ?? ""] ?? (element?.elementType == .staticText ? "static-text" : element?.elementType == .button ? "button" : element?.elementType == .image ? "image" : "other")
        findings[category + ":" + target, default: 0] += 1
        // Replace XCTest's raw element descriptions/attachments with a complete count.
        // The host writes the result and fails the job if any issue was reported.
        return true
      }
    } catch {
      XCTFail("BARO_AUDIT_EXECUTION_FAILED")
      throw AuditFailure.executionFailed
    }
    return [
      "viewport": viewport, "completed": true, "issueCount": count,
      "findings": findings.keys.sorted().map { key -> [String: Any] in
        let parts = key.split(separator: ":")
        return ["category": String(parts[0]), "target": String(parts[1]), "count": findings[key]!]
      }
    ]
  }
}
