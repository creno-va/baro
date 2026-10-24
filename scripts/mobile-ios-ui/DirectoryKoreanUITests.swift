import XCTest
import UIKit

// BARO_KOREAN_SETTINGS_OWNER_BEGIN
private func koreanSettingsOwnerChoice(cells: [CGRect], buttons: [CGRect], texts: [CGRect]) -> (selection: String, ownersOverlap: Bool) {
  guard [cells.count, buttons.count, texts.count].allSatisfy({ $0 <= 8 }) else { return ("ambiguous", false) }
  let primaryOwner = cells.first ?? buttons.first
  let owners: [CGRect] = cells + buttons
  let ownersOverlap: Bool
  if let primary = primaryOwner {
    ownersOverlap = owners.allSatisfy { (frame: CGRect) -> Bool in
      let area = frame.width * frame.height, shared = frame.intersection(primary)
      return area > 0 && shared.width * shared.height >= Swift.min(area, primary.width * primary.height) * 0.95
    }
  } else { ownersOverlap = true }
  guard cells.count <= 1 && buttons.count <= 1 && ownersOverlap else { return ("ambiguous", ownersOverlap) }
  if !cells.isEmpty { return ("cell", ownersOverlap) }
  if !buttons.isEmpty { return ("button", ownersOverlap) }
  if texts.count == 1 { return ("text", ownersOverlap) }
  return (texts.isEmpty ? "none" : "ambiguous", ownersOverlap)
}
// BARO_KOREAN_SETTINGS_OWNER_END

// Appended to DirectoryUITests.swift in the owned runner only. No product changes.
extension BaroDirectoryUITests {
  @MainActor
  private func settingsControl(_ aliases: [String], in settings: XCUIApplication, deriveCellFromKnownLabel: Bool = false) -> (element: XCUIElement?, cells: Int, buttons: Int, texts: Int, selection: String, ownersOverlap: Bool, cellQuerySource: String) {
    let predicates = aliases.flatMap { label in [NSPredicate(format: "label == %@", label), NSPredicate(format: "label BEGINSWITH %@", label + ",")] }
    let predicate = NSCompoundPredicate(orPredicateWithSubpredicates: predicates)
    let directCells = settings.cells.matching(predicate)
    let useDescendant = deriveCellFromKnownLabel && directCells.count == 0
    let cellQuery = useDescendant ? settings.cells.containing(NSPredicate(format: "label IN %@", aliases)) : directCells
    let buttonQuery = settings.buttons.matching(predicate)
    let textQuery = settings.staticTexts.matching(NSPredicate(format: "label IN %@", aliases))
    XCTAssertTrue([cellQuery.count, buttonQuery.count, textQuery.count].allSatisfy { $0 <= 8 }, "BARO_KOREAN_SETTINGS_CANDIDATES_EXCEEDED")
    @MainActor
    func visible(_ query: XCUIElementQuery) -> [XCUIElement] {
      guard query.count <= 8 else { return [] }
      return (0..<query.count).map { query.element(boundBy: $0) }.filter { self.fullyHittable($0, in: settings) }
    }
    let cells = visible(cellQuery), buttons = visible(buttonQuery), texts = visible(textQuery)
    let counts = (cells.count, buttons.count, texts.count)
    // Cell/button are actionable owners. Unscoped static captions cannot veto or
    // replace a unique owner; they are a fallback only when no owner exists.
    let choice = koreanSettingsOwnerChoice(cells: cells.map { $0.frame }, buttons: buttons.map { $0.frame }, texts: texts.map { $0.frame })
    let element: XCUIElement?
    switch choice.selection {
    case "cell": element = cells.first
    case "button": element = buttons.first
    case "text": element = texts.first
    default: element = nil
    }
    return (element, counts.0, counts.1, counts.2, choice.selection, choice.ownersOverlap, useDescendant ? "known-descendant" : "direct-label")
  }

  @MainActor
  private func reportLayoutStatus(_ stage: String, settings: XCUIApplication, element: XCUIElement?) {
    let value = element?.value
    let valueClass: String
    if value == nil { valueClass = "absent" }
    else if let string = value as? String {
      if string == "1" || string == "Selected" { valueClass = "selected" }
      else if string == "0" || string == "Not selected" { valueClass = "unselected" }
      else if string.isEmpty { valueClass = "empty" }
      else { valueClass = "other" }
    } else { valueClass = "other" }
    let done = settings.buttons.matching(NSPredicate(format: "label == %@", "Done"))
    XCTAssertTrue(done.count <= 8, "BARO_KOREAN_SETTINGS_CANDIDATES_EXCEEDED")
    let status: [String: Any] = [
      "stage": stage, "traitSelected": element?.isSelected ?? false, "valueClass": valueClass,
      "doneButtonCount": done.count, "doneHittable": done.count == 1 && fullyHittable(done.firstMatch, in: settings),
      "doneInNavigationBar": settings.navigationBars.buttons["Done"].exists,
      "standardObserved": settings.staticTexts["Standard"].exists || settings.buttons["Standard"].exists,
      "tenKeyObserved": settings.staticTexts["10 Key"].exists || settings.staticTexts["10-Key"].exists || settings.buttons["10 Key"].exists || settings.buttons["10-Key"].exists,
      "koreanTitleObserved": settings.navigationBars["Korean"].exists
    ]
    if let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]) {
      print("BARO_KOREAN_LAYOUT_STATUS:" + String(decoding: data, as: UTF8.self))
    }
  }

  @MainActor
  private func koreanStatus(_ stage: String, matches: Bool, keyboard: Bool) {
    let status: [String: Any] = ["stage": stage, "expectedValueMatches": matches, "keyboardObserved": keyboard]
    if let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]) {
      print("BARO_KOREAN_UI_STATUS:" + String(decoding: data, as: UTF8.self))
    }
  }

  @MainActor
  private func openKoreanLayoutSettings() -> XCUIApplication? {
    let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    settings.launch()
    XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 30), "BARO_KOREAN_SETTINGS_MISSING")
    // Official Settings navigation, only on the fresh owned CI Simulator.
    // No preferences database edits, keyboard extensions, account entry or shortcuts.
    for (index, aliases) in [["General"], ["Keyboard"], ["Keyboards"], ["Add New Keyboard…", "Add New Keyboard...", "Add New Keyboard"], ["Korean"]].enumerated() {
      let stage = ["general", "keyboard", "keyboard-list", "add-keyboard", "korean"][index]
      print("BARO_KOREAN_SETUP_STAGE:" + stage)
      var control = settingsControl(aliases, in: settings)
      var scrolls = 0
      while control.selection == "none" && scrolls < 12 {
        settings.swipeUp()
        scrolls += 1
        control = settingsControl(aliases, in: settings)
      }
      let diagnostic: [String: Any] = ["stage": stage, "cellCount": control.cells, "buttonCount": control.buttons, "textCount": control.texts, "selection": control.selection, "ownersOverlap": control.ownersOverlap, "scrolls": scrolls]
      if let data = try? JSONSerialization.data(withJSONObject: diagnostic, options: [.sortedKeys]) {
        print("BARO_KOREAN_SETUP_CONTROL:" + String(decoding: data, as: UTF8.self))
      }
      XCTAssertNotNil(control.element, "BARO_KOREAN_SETTINGS_CONTROL_MISSING")
      guard let element = control.element else { return nil }
      element.tap()
    }
    return settings
  }

  @MainActor
  private func addKoreanKeyboard() -> (separateKeyboardChosen: Bool, settingsLayoutChoiceObserved: Bool)? {
    guard let settings = openKoreanLayoutSettings() else { return nil }
    defer { settings.terminate() }
    print("BARO_KOREAN_SETUP_STAGE:layout")
    // Observed on the product-free iOS26.5 reference: Korean first offers
    // adding to English (US) or a separate keyboard, rather than a layout row.
    let titleObserved = settings.navigationBars["Korean"].exists
    let promptObserved = settings.staticTexts["Add to English (US) Keyboard"].exists
    let choicePredicate = NSPredicate(format: "label == %@", "Add New Keyboard")
    let separateCells = settings.cells.matching(choicePredicate)
    let separateButtons = settings.buttons.matching(choicePredicate)
    XCTAssertTrue(separateCells.count <= 8 && separateButtons.count <= 8, "BARO_KOREAN_SETTINGS_CANDIDATES_EXCEEDED")
    // A sheet can expose background controls too. Only fully hittable owners in
    // the current window qualify, and the existing 95% owner policy still applies.
    let activeCells = separateCells.allElementsBoundByIndex.filter { fullyHittable($0, in: settings) }
    let activeButtons = separateButtons.allElementsBoundByIndex.filter { fullyHittable($0, in: settings) }
    let owner = koreanSettingsOwnerChoice(cells: activeCells.map { $0.frame }, buttons: activeButtons.map { $0.frame }, texts: [])
    let knownChooser = titleObserved && promptObserved
    let actionable = owner.selection == "cell" || owner.selection == "button"
    let decision = !knownChooser ? "legacy-layout" : actionable ? "separate-keyboard" : "blocked"
    let choice: [String: Any] = ["koreanTitleObserved": titleObserved, "promptObserved": promptObserved, "cellCount": activeCells.count, "buttonCount": activeButtons.count, "ownersOverlap": owner.ownersOverlap, "selection": owner.selection, "decision": decision]
    if let data = try? JSONSerialization.data(withJSONObject: choice, options: [.sortedKeys]) {
      print("BARO_KOREAN_SEPARATE_CHOICE:" + String(decoding: data, as: UTF8.self))
    }
    XCTAssertNotEqual(decision, "blocked", "BARO_KOREAN_SEPARATE_CHOICE_MISSING")
    guard decision != "blocked" else { return nil }
    var separateKeyboardChosen = false
    if decision == "separate-keyboard" {
      let element = owner.selection == "cell" ? activeCells.first : activeButtons.first
      XCTAssertNotNil(element, "BARO_KOREAN_SEPARATE_CHOICE_MISSING")
      guard let element else { return nil }
      element.tap()
      separateKeyboardChosen = true
    }
    let aliases = ["2-Set", "2-Set (QWERTY)"]
    var layout = settingsControl(aliases, in: settings, deriveCellFromKnownLabel: true)
    _ = wait({
      layout = self.settingsControl(aliases, in: settings, deriveCellFromKnownLabel: true)
      return layout.selection != "none"
    }, seconds: 10)
    let diagnostic: [String: Any] = ["stage": "layout", "cellCount": layout.cells, "buttonCount": layout.buttons, "textCount": layout.texts, "selection": layout.selection, "ownersOverlap": layout.ownersOverlap, "cellQuerySource": layout.cellQuerySource, "scrolls": 0]
    if let data = try? JSONSerialization.data(withJSONObject: diagnostic, options: [.sortedKeys]) {
      print("BARO_KOREAN_SETUP_CONTROL:" + String(decoding: data, as: UTF8.self))
    }
    reportLayoutStatus("before-selection", settings: settings, element: layout.element)
    let settingsLayoutChoiceObserved = layout.cells + layout.buttons + layout.texts > 0
    if settingsLayoutChoiceObserved {
      XCTAssertTrue(layout.selection == "cell" || layout.selection == "button", "BARO_KOREAN_LAYOUT_ACTIONABLE_OWNER_MISSING")
      guard let layoutElement = layout.element, layout.selection == "cell" || layout.selection == "button" else { return nil }
      let alreadySelected = layoutElement.isSelected || (layoutElement.value as? String) == "1" || (layoutElement.value as? String) == "Selected"
      if !alreadySelected { layoutElement.tap() }
      reportLayoutStatus("after-selection", settings: settings, element: layoutElement)
    } else {
      // Only the observed separate-keyboard path may retain the OS default.
      // The actual visible jamo keys and all composition/edit checks remain mandatory.
      XCTAssertTrue(separateKeyboardChosen, "BARO_KOREAN_LAYOUT_MISSING")
      guard separateKeyboardChosen else { return nil }
    }
    print("BARO_KOREAN_SETUP_STAGE:done")
    var done = settingsControl(["Done"], in: settings)
    _ = wait({ done = self.settingsControl(["Done"], in: settings); return done.selection != "none" }, seconds: 10)
    let doneDiagnostic: [String: Any] = ["stage": "done", "cellCount": done.cells, "buttonCount": done.buttons, "textCount": done.texts, "selection": done.selection, "ownersOverlap": done.ownersOverlap, "scrolls": 0]
    if let data = try? JSONSerialization.data(withJSONObject: doneDiagnostic, options: [.sortedKeys]) {
      print("BARO_KOREAN_SETUP_CONTROL:" + String(decoding: data, as: UTF8.self))
    }
    XCTAssertTrue(done.selection == "cell" || done.selection == "button", "BARO_KOREAN_SETTINGS_DONE_MISSING")
    guard let doneElement = done.element, done.selection == "cell" || done.selection == "button" else { return nil }
    doneElement.tap()
    print("BARO_KOREAN_SETUP_STAGE:readback")
    XCTAssertTrue(settings.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "Korean")).firstMatch.waitForExistence(timeout: 10), "BARO_KOREAN_SETTINGS_READBACK_MISSING")
    return (separateKeyboardChosen, settingsLayoutChoiceObserved)
  }

  @MainActor
  private func tapKoreanKey(_ label: String, keyboard: XCUIElement, app: XCUIApplication) {
    let keys = keyboard.keys.matching(NSPredicate(format: "label == %@", label))
    XCTAssertTrue(keys.count == 1 && fullyHittable(keys.firstMatch, in: app), "BARO_KOREAN_KEY_MISSING")
    let frame = keys.firstMatch.frame, kb = keyboard.frame
    XCTAssertTrue(frame.intersection(kb).width >= frame.width * 0.95 && frame.intersection(kb).height >= frame.height * 0.95, "BARO_KOREAN_KEY_OUTSIDE_KEYBOARD")
    keys.firstMatch.tap()
  }

  @MainActor
  func testPublicDirectoryKoreanCompositionAndRotation() throws {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    defer { XCUIDevice.shared.orientation = .portrait }
    guard let keyboardSetup = addKoreanKeyboard() else { return }
    let app = XCUIApplication(bundleIdentifier: "site.baro.app.preview")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "BARO_DIRECTORY_FOREGROUND_MISSING")
    let home = app.staticTexts["내 상황을 차근차근 정리해요."]
    XCTAssertTrue(home.waitForExistence(timeout: 30), "BARO_DIRECTORY_HOME_MISSING")
    let browse = app.buttons["변호사 탐색"]
    reach(browse, in: app)
    browse.tap()
    let empty = app.staticTexts["공개된 프로필을 준비하고 있어요"]
    XCTAssertTrue(wait {
      !app.staticTexts["공개 프로필을 확인하고 있어요"].exists && !app.staticTexts["목록을 불러오지 못했어요"].exists
        && (empty.exists || app.staticTexts.matching(NSPredicate(format: "label IN %@", ["자격 확인 프로필", "본인 작성 프로필"])).firstMatch.exists)
    }, "BARO_DIRECTORY_READY_MISSING")
    let initialReadyState = empty.exists ? "empty" : "cards"
    let input = app.textFields["이름으로 검색"]
    reach(input, in: app)
    input.tap()
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "BARO_DIRECTORY_KEYBOARD_MISSING")
    XCTAssertTrue(wait { self.fullyHittable(input, in: app) && input.frame.maxY <= keyboard.frame.minY }, "BARO_DIRECTORY_INPUT_OCCLUDED")
    // Bounded language cycling; require visible jamo keys before any product input.
    var switches = 0
    while !keyboard.keys["ㅂ"].exists && switches < 3 {
      let next = keyboard.buttons["Next keyboard"]
      XCTAssertTrue(next.exists && next.isHittable, "BARO_KOREAN_SWITCH_MISSING")
      next.tap()
      switches += 1
    }
    XCTAssertTrue(keyboard.keys["ㅂ"].exists && keyboard.keys["ㅏ"].exists, "BARO_KOREAN_KEYBOARD_MISSING")
    XCTAssertTrue(fullyHittable(input, in: app) && input.frame.maxY <= keyboard.frame.minY, "BARO_DIRECTORY_INPUT_OCCLUDED")
    XCTAssertTrue((input.value as? String) == "", "BARO_DIRECTORY_INITIAL_INPUT_NOT_EMPTY")
    // Actual software jamo taps exercise final-consonant resyllabification.
    for (index, step) in [("ㅂ", "ㅂ"), ("ㅏ", "바"), ("ㄹ", "발"), ("ㅗ", "바로")].enumerated() {
      tapKoreanKey(step.0, keyboard: keyboard, app: app)
      let matches = wait({ (input.value as? String) == step.1 }, seconds: 10)
      koreanStatus("compose-\(index + 1)", matches: matches, keyboard: keyboard.exists)
      XCTAssertTrue(matches, "BARO_KOREAN_COMPOSITION_MISMATCH")
    }
    // Commit the composition with a real space, then delete that space and append.
    tapKoreanKey("space", keyboard: keyboard, app: app)
    XCTAssertTrue(wait { (input.value as? String) == "바로 " }, "BARO_KOREAN_COMMIT_MISMATCH")
    tapKoreanKey("delete", keyboard: keyboard, app: app)
    XCTAssertTrue(wait { (input.value as? String) == "바로" }, "BARO_KOREAN_DELETE_MISMATCH")
    tapKoreanKey("ㅂ", keyboard: keyboard, app: app)
    tapKoreanKey("ㅏ", keyboard: keyboard, app: app)
    let retained = wait({ (input.value as? String) == "바로바" }, seconds: 10)
    koreanStatus("edited", matches: retained, keyboard: keyboard.exists)
    XCTAssertTrue(retained, "BARO_KOREAN_EDIT_MISMATCH")
    let search = softwareSearchControl(keyboard: keyboard, app: app)
    XCTAssertNotNil(search, "BARO_DIRECTORY_SOFTWARE_SEARCH_MISSING")
    guard let search else { return }
    search.element.tap()
    XCTAssertTrue(wait { !keyboard.exists }, "BARO_DIRECTORY_KEYBOARD_NOT_DISMISSED")
    // The fixed query may match a future public profile. Only completion state is observed.
    XCTAssertTrue(wait { !app.staticTexts["공개 프로필을 확인하고 있어요"].exists && !app.staticTexts["목록을 불러오지 못했어요"].exists }, "BARO_KOREAN_SEARCH_UNSETTLED")
    for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
      XCUIDevice.shared.orientation = orientation
      XCTAssertTrue(wait {
        let frame = app.windows.firstMatch.frame
        return frame.width > 0 && frame.height > 0 && (orientation == .portrait ? frame.height > frame.width : frame.width > frame.height)
      }, "BARO_KOREAN_ROTATION_MISSING")
      reach(input, in: app)
      XCTAssertTrue((input.value as? String) == "바로바", "BARO_KOREAN_ROTATED_VALUE_MISMATCH")
    }
    let back = app.navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["BARO", "Back"]))
    XCTAssertTrue(back.count == 1 && fullyHittable(back.firstMatch, in: app), "BARO_DIRECTORY_BACK_MISSING")
    back.firstMatch.tap()
    XCTAssertTrue(home.waitForExistence(timeout: 30) && !input.exists, "BARO_DIRECTORY_HOME_RETURN_MISSING")
    let result: [String: Any] = [
      "kind": "ios-public-directory-korean-software-composition", "applicationId": "site.baro.app.preview",
      "initialReadyState": initialReadyState, "keyboardSetup": "owned-simulator-settings-ui", "keyboardLayout": "korean-2-set",
      "separateKeyboardChosen": keyboardSetup.separateKeyboardChosen, "settingsLayoutChoiceObserved": keyboardSetup.settingsLayoutChoiceObserved,
      "softwareJamoTapCount": 6, "compositionCheckpoints": 4, "compositionRetained": true, "spaceCommitVerified": true,
      "spaceDeletionVerified": true, "appendAfterCommitVerified": true, "keyboardObserved": true, "focusedInputAboveKeyboard": true,
      "searchSubmitMethod": "software-keyboard-search", "searchSubmitControlKind": search.kind,
      "searchCompletedWithoutError": true, "keyboardDismissed": true, "landscapeInputRetained": true, "portraitInputRetained": true,
      "homeReturnObserved": true, "publicDataNavigation": true, "profileOpened": false, "contactOpened": false,
      "remoteMutationPerformed": false, "authenticationNavigation": false, "privateDataAccess": false,
      "typeTextCalls": 0, "pastePerformed": false, "preferencesDatabaseEdited": false, "rawInputExported": false,
      "koreanKeyboardVerified": true, "voiceOverVerified": false, "physicalDeviceVerified": false, "httpTransportSeparatelyObserved": false
    ]
    print("BARO_DIRECTORY_UI_RESULT:" + String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
    app.terminate()
  }
}
