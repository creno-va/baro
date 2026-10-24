import XCTest

// BARO_INPUT_REFERENCE_SIGNATURE

final class BaroInputReferenceUITests: XCTestCase {
  @MainActor
  private func wait(_ condition: @escaping () -> Bool, seconds: TimeInterval = 10) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      if condition() { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    return condition()
  }

  @MainActor
  func testSingleSyntheticInput() throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "site.baro.test.input-reference")
    app.launch()
    defer { app.terminate() }
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_REFERENCE_FOREGROUND_MISSING")
    let input = app.textFields["BARO.reference.input"]
    XCTAssertTrue(input.waitForExistence(timeout: 30) && input.isHittable, "BARO_REFERENCE_INPUT_MISSING")
    input.tap()
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "BARO_REFERENCE_KEYBOARD_MISSING")
    XCTAssertTrue(wait {
      input.isHittable && input.frame.height > 0 && input.frame.maxY <= keyboard.frame.minY
    }, "BARO_REFERENCE_INPUT_OCCLUDED")
    let initial = input.value as? String
    XCTAssertTrue(initial == nil || initial == "", "BARO_REFERENCE_INITIAL_INPUT_NOT_EMPTY")
    let synthetic = "baro-mobile-smoke-20261024"
    input.typeText(synthetic)
    // Observe with the product's same bounded wait; a mismatch is diagnostic data, not a pass.
    _ = wait { (input.value as? String) == synthetic }
    let accessibilitySignature = directoryInputSignature(input.value as? String)
    let native = app.staticTexts["BARO.reference.observation"]
    XCTAssertTrue(native.exists, "BARO_REFERENCE_NATIVE_OBSERVER_MISSING")
    guard let encoded = native.value as? String,
      let data = encoded.data(using: .utf8),
      let facts = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let nativeSignature = facts["signature"] as? [String: Bool],
      let changeEvents = facts["changeEvents"] as? Int,
      nativeSignature.count == 14, (0...100).contains(changeEvents) else {
      XCTFail("BARO_REFERENCE_NATIVE_OBSERVER_INVALID")
      return
    }
    let result: [String: Any] = [
      "kind": "ios-uikit-single-input-reference-only",
      "applicationId": "site.baro.test.input-reference",
      "observationCompleted": true, "initiallyEmpty": true, "keyboardObserved": true,
      "inputAboveKeyboard": true, "typeTextCalls": 1,
      "pastePerformed": false, "typingSpeedChanged": false, "normalizationApplied": false,
      "accessibilitySignature": accessibilitySignature, "nativeSignature": nativeSignature,
      "signaturesAgree": accessibilitySignature == nativeSignature, "nativeChangeEvents": changeEvents,
      "productInputVerified": false, "rootCauseConfirmed": false,
      "rawInputExported": false, "koreanKeyboardVerified": false
    ]
    let encodedResult = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print("BARO_INPUT_REFERENCE_RESULT:" + String(decoding: encodedResult, as: UTF8.self))
  }
}
