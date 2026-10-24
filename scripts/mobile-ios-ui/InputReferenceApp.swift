import UIKit

// BARO_INPUT_REFERENCE_SIGNATURE

// Synthetic, network-free reference. Never changes the field text during editing.
@main
final class InputReferenceApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private let input = UITextField()
  private let observation = UILabel()
  private var changeEvents = 0

  func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    input.accessibilityIdentifier = "BARO.reference.input"
    input.accessibilityLabel = "BARO reference input"
    input.borderStyle = .roundedRect
    input.autocorrectionType = .no
    input.autocapitalizationType = .sentences
    input.returnKeyType = .search
    input.addTarget(self, action: #selector(changed), for: .editingChanged)
    observation.text = "Synthetic native input observation"
    observation.accessibilityIdentifier = "BARO.reference.observation"
    observation.isAccessibilityElement = true
    let views: [UIView] = [input, observation]
    for item in views {
      item.translatesAutoresizingMaskIntoConstraints = false
      controller.view.addSubview(item)
    }
    let safe = controller.view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      input.topAnchor.constraint(equalTo: safe.topAnchor, constant: 24),
      input.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24),
      input.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
      input.heightAnchor.constraint(equalToConstant: 56),
      observation.topAnchor.constraint(equalTo: input.bottomAnchor, constant: 16),
      observation.leadingAnchor.constraint(equalTo: input.leadingAnchor),
      observation.trailingAnchor.constraint(equalTo: input.trailingAnchor)
    ])
    publish()
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = controller
    self.window = window
    window.makeKeyAndVisible()
    return true
  }

  @objc private func changed() {
    changeEvents = min(changeEvents + 1, 100)
    publish()
  }

  private func publish() {
    let facts: [String: Any] = [
      "signature": directoryInputSignature(input.text),
      "changeEvents": changeEvents
    ]
    if let data = try? JSONSerialization.data(withJSONObject: facts, options: [.sortedKeys]) {
      observation.accessibilityValue = String(decoding: data, as: UTF8.self)
    }
  }
}
