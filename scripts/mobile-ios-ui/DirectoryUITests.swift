import XCTest

// BARO_DIRECTORY_SIGNATURE_BEGIN
private func directoryInputSignature(_ observed: String?) -> [String: Bool] {
  let expected = "baro-mobile-smoke-20261024"
  let value = observed ?? ""
  let lower = value.lowercased()
  let withoutWhitespace = value.filter { !$0.isWhitespace }
  func normalizeDashes(_ text: String) -> String {
    text.map { "‐‑‒–—−﹣－".contains($0) ? "-" : String($0) }.joined()
  }
  let compatible = value.precomposedStringWithCompatibilityMapping
  let normalized = normalizeDashes(compatible).lowercased().filter { !$0.isWhitespace }
  var remaining = lower.makeIterator()
  var next = remaining.next()
  for character in expected where next != nil {
    if character == next { next = remaining.next() }
  }
  let expectedScalars = Set(expected.unicodeScalars)
  return [
    "stringObserved": observed != nil,
    "expectedLengthMatches": value.utf16.count == expected.utf16.count,
    "caseFoldMatches": lower == expected,
    "whitespaceRemovalMatches": withoutWhitespace == expected,
    "dashNormalizationMatches": normalizeDashes(value) == expected,
    "compatibilityNormalizationMatches": compatible == expected,
    "knownNormalizationMatches": normalized == expected,
    "expectedSubsequenceOnly": !value.isEmpty && next == nil,
    "containsKnownPayload": lower.contains(expected),
    "allKnownSegmentsPresent": ["baro", "mobile", "smoke", "20261024"].allSatisfy { lower.contains($0) },
    "knownDigitSuffixMatches": value.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("20261024"),
    "containsHangul": value.unicodeScalars.contains { (0x1100...0x11ff).contains($0.value) || (0x3130...0x318f).contains($0.value) || (0xac00...0xd7af).contains($0.value) },
    "matchesFixedFieldLabel": value == "이름으로 검색",
    "onlyExpectedScalarsAfterCaseFold": !value.isEmpty && lower.unicodeScalars.allSatisfy { expectedScalars.contains($0) }
  ]
}
// BARO_DIRECTORY_SIGNATURE_END

/// Public directory only. Fixed synthetic input and enums; never inspect profile values.
final class BaroDirectoryUITests: XCTestCase {
  @MainActor
  private func wait(_ condition: @escaping () -> Bool, seconds: TimeInterval = 30) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      if condition() { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    return condition()
  }

  @MainActor
  private func fullyHittable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.exists, element.isHittable else { return false }
    let frame = element.frame
    let window = app.windows.firstMatch.frame
    guard [frame.minX, frame.minY, frame.width, frame.height, window.width, window.height].allSatisfy({ $0.isFinite }),
      frame.width > 0, frame.height > 0, window.width > 0, window.height > 0 else { return false }
    let visible = frame.intersection(window)
    return visible.width >= frame.width * 0.95 && visible.height >= frame.height * 0.95
  }

  @MainActor
  private func reach(_ element: XCUIElement, in app: XCUIApplication) {
    XCTAssertTrue(element.waitForExistence(timeout: 30), "BARO_DIRECTORY_CONTROL_MISSING")
    var swipes = 0
    while !fullyHittable(element, in: app) && swipes < 16 {
      let scroll = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.collectionViews.firstMatch
      XCTAssertTrue(scroll.exists, "BARO_DIRECTORY_SCROLL_MISSING")
      if element.frame.maxY < app.windows.firstMatch.frame.midY { scroll.swipeDown() }
      else { scroll.swipeUp() }
      swipes += 1
    }
    XCTAssertTrue(fullyHittable(element, in: app), "BARO_DIRECTORY_CONTROL_NOT_HITTABLE")
  }

  @MainActor
  private func reportInput(_ stage: String, input: XCUIElement, app: XCUIApplication) {
    let expected = "baro-mobile-smoke-20261024"
    let sentence = "Baro-mobile-smoke-20261024"
    let observed = input.exists ? input.value as? String : nil
    let state: String
    if let value = observed {
      if value.isEmpty { state = "empty" }
      else if value == expected { state = "literal" }
      else if value == sentence { state = "sentence-capitalized" }
      else if expected.hasPrefix(value) || sentence.hasPrefix(value) { state = "prefix" }
      else { state = "other" }
    } else { state = "unavailable" }
    // Only enum/booleans. Never print value, label, length, hierarchy or profile content.
    let status: [String: Any] = [
      "stage": stage, "inputState": state, "inputSignature": directoryInputSignature(observed),
      "appForeground": app.state == .runningForeground,
      "keyboardObserved": app.keyboards.firstMatch.exists
    ]
    if let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]) {
      print("BARO_DIRECTORY_UI_STATUS:" + String(decoding: data, as: UTF8.self))
    }
  }

  @MainActor
  func testPublicDirectoryKeyboardAndRotation() throws {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    defer { XCUIDevice.shared.orientation = .portrait }
    let app = XCUIApplication(bundleIdentifier: "site.baro.app.preview")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_DIRECTORY_FOREGROUND_MISSING")
    let home = app.staticTexts["내 상황을 차근차근 정리해요."]
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_DIRECTORY_HOME_MISSING")
    let browse = app.buttons["변호사 탐색"]
    reach(browse, in: app)
    browse.tap()
    // Query only fixed status labels. Profile labels/names/IDs are never read or printed.
    let empty = app.staticTexts["공개된 프로필을 준비하고 있어요"]
    let ready = wait {
      !app.staticTexts["공개 프로필을 확인하고 있어요"].exists
        && !app.staticTexts["목록을 불러오지 못했어요"].exists
        && !app.staticTexts["앱 설정을 확인해 주세요"].exists
        && (empty.exists || app.staticTexts.matching(NSPredicate(format: "label == %@", "자격 확인 프로필")).firstMatch.exists || app.staticTexts.matching(NSPredicate(format: "label == %@", "본인 작성 프로필")).firstMatch.exists)
    }
    XCTAssertTrue(ready, "BARO_DIRECTORY_READY_MISSING")
    let initialReadyState = empty.exists ? "empty" : "cards"
    let input = app.textFields["이름으로 검색"]
    XCTAssertTrue(input.waitForExistence(timeout: 30), "BARO_DIRECTORY_INPUT_MISSING")
    reach(input, in: app)
    input.tap()
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "BARO_DIRECTORY_KEYBOARD_MISSING")
    // Do not swipe after focus: that would conceal a keyboard-avoidance defect.
    XCTAssertTrue(wait({
      self.fullyHittable(input, in: app) && keyboard.frame.height > 0
        && keyboard.frame.minY.isFinite && input.frame.maxY <= keyboard.frame.minY
    }, seconds: 10), "BARO_DIRECTORY_INPUT_OCCLUDED")
    let synthetic = "baro-mobile-smoke-20261024"
    reportInput("before-input", input: input, app: app)
    let initialInput = input.value as? String
    XCTAssertTrue(initialInput == nil || initialInput == "", "BARO_DIRECTORY_INITIAL_INPUT_NOT_EMPTY")
    input.typeText(synthetic)
    reportInput("after-input", input: input, app: app)
    let typedRetained = wait({ (input.value as? String) == synthetic }, seconds: 10)
    reportInput("typed-check", input: input, app: app)
    XCTAssertTrue(typedRetained, "BARO_DIRECTORY_TYPED_INPUT_MISMATCH")
    input.typeText("\n")
    XCTAssertTrue(wait({ !keyboard.exists }, seconds: 10), "BARO_DIRECTORY_KEYBOARD_NOT_DISMISSED")
    XCTAssertTrue(wait({
      app.staticTexts["검색 결과가 없어요"].exists
        && !app.staticTexts["공개 프로필을 확인하고 있어요"].exists
        && !app.staticTexts["목록을 불러오지 못했어요"].exists
    }), "BARO_DIRECTORY_SEARCH_EMPTY_MISSING")
    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertTrue(wait({
      let frame = app.windows.firstMatch.frame
      return frame.width.isFinite && frame.height.isFinite && frame.height > 0 && frame.width > frame.height
    }), "BARO_DIRECTORY_LANDSCAPE_MISSING")
    reportInput("landscape-check", input: input, app: app)
    reach(input, in: app)
    reportInput("landscape-check", input: input, app: app)
    XCTAssertTrue((input.value as? String) == synthetic, "BARO_DIRECTORY_LANDSCAPE_INPUT_MISMATCH")
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(wait({
      let frame = app.windows.firstMatch.frame
      return frame.width.isFinite && frame.height.isFinite && frame.width > 0 && frame.height > frame.width
    }), "BARO_DIRECTORY_PORTRAIT_MISSING")
    reportInput("portrait-check", input: input, app: app)
    reach(input, in: app)
    reportInput("portrait-check", input: input, app: app)
    XCTAssertTrue((input.value as? String) == synthetic, "BARO_DIRECTORY_PORTRAIT_INPUT_MISMATCH")
    let back = app.navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["BARO", "Back"]))
    XCTAssertTrue(back.count == 1 && fullyHittable(back.firstMatch, in: app), "BARO_DIRECTORY_BACK_MISSING")
    back.firstMatch.tap()
    XCTAssertTrue(home.waitForExistence(timeout: 30) && !input.exists, "BARO_DIRECTORY_HOME_RETURN_MISSING")
    let result: [String: Any] = [
      "kind": "ios-public-directory-keyboard-rotation", "applicationId": "site.baro.app.preview",
      "initialReadyState": initialReadyState,
      "inputFullyHittable": true, "keyboardObserved": true, "focusedInputAboveKeyboard": true,
      "syntheticAsciiInputRetained": true, "searchSubmittedByKeyboard": true,
      "keyboardDismissed": true, "filteredEmptyStateObserved": true,
      "landscapeWindowObserved": true, "landscapeInputRetained": true, "landscapeInputFullyHittable": true,
      "portraitWindowObserved": true, "portraitInputRetained": true, "portraitInputFullyHittable": true,
      "homeReturnObserved": true, "publicDataNavigation": true,
      "profileOpened": false, "contactOpened": false, "remoteMutationPerformed": false,
      "authenticationNavigation": false, "privateDataAccess": false, "koreanKeyboardVerified": false,
      "voiceOverVerified": false, "httpTransportSeparatelyObserved": false
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print("BARO_DIRECTORY_UI_RESULT:" + String(decoding: data, as: UTF8.self))
    app.terminate()
  }
}
