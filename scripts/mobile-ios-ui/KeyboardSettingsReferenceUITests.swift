// Appended in the same file as the actual Settings navigation helpers.
// Only a fresh owned Simulator with no BARO product or user account is permitted.
extension BaroDirectoryUITests {
  @MainActor
  func testKoreanLayoutReference() throws {
    continueAfterFailure = false
    guard let settings = openKoreanLayoutSettings() else { return }
    defer { settings.terminate() }
    XCTAssertTrue(settings.navigationBars["Korean"].waitForExistence(timeout: 10), "BARO_KEYBOARD_REFERENCE_SCOPE_MISSING")
    let done = settings.buttons["Done"]
    XCTAssertTrue(done.exists && done.isHittable, "BARO_KEYBOARD_REFERENCE_SCOPE_MISSING")
    let window = settings.windows.firstMatch.frame
    let bars = settings.navigationBars.allElementsBoundByIndex.map { $0.frame }
    var observations: [[String: String]] = []
    // Flat, bounded public OS control names only. No values, identifiers, frames,
    // relationships, screenshots, hierarchy dumps or product navigation.
    for (kind, query) in [("cell", settings.cells), ("button", settings.buttons), ("static-text", settings.staticTexts)] {
      XCTAssertLessThanOrEqual(query.count, 64, "BARO_KEYBOARD_REFERENCE_BOUND_EXCEEDED")
      for element in query.allElementsBoundByIndex {
        let frame = element.frame
        guard element.exists, frame.width > 0, frame.height > 0,
          [frame.minX, frame.minY, frame.width, frame.height].allSatisfy({ $0.isFinite }),
          !bars.contains(where: { !$0.intersection(frame).isEmpty }),
          window.intersection(frame).width >= frame.width * 0.95,
          window.intersection(frame).height >= frame.height * 0.95 else { continue }
        let label = element.label
        if label.isEmpty { continue }
        XCTAssertLessThanOrEqual(label.utf16.count, 160, "BARO_KEYBOARD_REFERENCE_LABEL_BOUND_EXCEEDED")
        observations.append(["kind": kind, "label": label])
      }
    }
    XCTAssertTrue(!observations.isEmpty && observations.count <= 32, "BARO_KEYBOARD_REFERENCE_CHOICES_MISSING")
    let result: [String: Any] = [
      "kind": "ios-owned-korean-settings-control-reference-only",
      "screen": "Korean", "doneObserved": true, "controls": observations,
      "layoutSelected": false, "productInputVerified": false, "koreanKeyboardVerified": false,
      "rawHierarchyExported": false, "rawValuesExported": false,
      "screenshotsExported": false, "rawXcresultExported": false
    ]
    print("BARO_KEYBOARD_REFERENCE_RESULT:" + String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
  }
}
