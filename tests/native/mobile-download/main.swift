import Foundation
import Darwin

let args = CommandLine.arguments
if args.count < 6 { exit(2) }
let origin = args[1], path = args[2], maximum = Int64(args[3]) ?? 0, mode = args[4]
let root = URL(fileURLWithPath: args[5], isDirectory: true)
let store = DiskTransferStore(cacheRoot: root, expectedOrigin: mode == "preview-fence" ? "https://preview.baro.site" : nil)
let ambient = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "baro_native_probe_ambient", .value: "synthetic_ambient"])
let existing = HTTPCookieStorage.shared.cookies?.filter { $0.name == "baro_native_probe_ambient" || $0.name == "download_probe" } ?? []
if let ambient { HTTPCookieStorage.shared.setCookie(ambient) }
func cleanupCookies() {
  if let ambient { HTTPCookieStorage.shared.deleteCookie(ambient) }
  HTTPCookieStorage.shared.cookies?.filter { $0.name == "download_probe" && $0.domain == "127.0.0.1" && $0.value == "synthetic" }.forEach { HTTPCookieStorage.shared.deleteCookie($0) }
  existing.forEach { HTTPCookieStorage.shared.setCookie($0) }
}
defer { cleanupCookies() }
func failProbe(_ code: Int32) -> Never { cleanupCookies(); exit(code) }
if mode == "orphan" {
  let nativeRoot = root.appendingPathComponent("baro_native_transfers", isDirectory: true)
  try FileManager.default.createDirectory(at: nativeRoot, withIntermediateDirectories: true)
  try Data("synthetic abandoned transfer".utf8).write(to: nativeRoot.appendingPathComponent(UUID().uuidString.lowercased() + ".bin"))
  try Data("synthetic abandoned payload".utf8).write(to: nativeRoot.appendingPathComponent(UUID().uuidString.lowercased() + ".upload"))
  let cleared = DispatchSemaphore(value: 0); var valid = false
  store.clear { ok in valid = ok; cleared.signal() }
  guard cleared.wait(timeout: .now() + 5) == .success, valid,
    (try FileManager.default.contentsOfDirectory(atPath: nativeRoot.path)).isEmpty else { failProbe(6) }
}
let id = try store.reserve()
var headers = ["origin": origin]
if mode != "jar" { headers["cookie"] = "baro_probe=synthetic_explicit" }
let input = DiskTransferInput(url: origin + path, origin: origin, method: mode == "post" ? "POST" : "GET", headers: headers, body: mode == "post" ? "{\"selectedFileIds\":[\"synthetic_file\"]}" : nil, maximum: maximum)
var transfer = input
if mode.hasPrefix("upload") {
  guard args.count >= 8, let size = Int64(args[6]) else { failProbe(7) }
  let sources = root.appendingPathComponent("baro_local_private_uploads", isDirectory: true)
  try FileManager.default.createDirectory(at: sources, withIntermediateDirectories: true)
  let name = UUID().uuidString.lowercased(), source = sources.appendingPathComponent(name)
  _ = FileManager.default.createFile(atPath: source.path, contents: nil)
  let output = try FileHandle(forWritingTo: source)
  let chunk = Data((0..<65_536).map { UInt8($0 % 251) }); var written: Int64 = 0
  while written < size { let count = min(chunk.count, Int(size - written)); try output.write(contentsOf: chunk.prefix(count)); written += Int64(count) }
  try output.close()
  if mode == "upload-symlink" {
    let actual = sources.appendingPathComponent(UUID().uuidString.lowercased())
    try FileManager.default.moveItem(at: source, to: actual); try FileManager.default.createSymbolicLink(at: source, withDestinationURL: actual)
  }
  headers["content-type"] = "application/octet-stream"; headers["if-match"] = "7"
  if mode == "upload-invalid-header" { headers["authorization"] = "synthetic_forbidden" }
  let upload = DiskUploadSource(sourceName: mode == "upload-path" ? "../outside" : name, byteLength: mode == "upload-size" ? size + 1 : size, contentHash: mode == "upload-hash" ? String(repeating: "0", count: 64) : args[7])
  transfer = DiskTransferInput(url: origin + path, origin: origin, method: "PUT", headers: headers, body: nil, maximum: 65_536, upload: upload)
}
if mode == "pre-cancel" { store.cancel(id: id) }
let done = DispatchSemaphore(value: 0)
var result: DiskTransferResult?
store.download(id: id, input: transfer) { value in
  if case .success(let response) = value { result = response }
  done.signal()
}
if mode == "cancel" { DispatchQueue.global().asyncAfter(deadline: .now() + 0.08) { store.cancel(id: id) } }
if mode == "upload-cancel" { DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { store.cancel(id: id) } }
if done.wait(timeout: .now() + 90) == .timedOut { store.cancel(id: id); failProbe(3) }
if let response = result, !response.uri.isEmpty {
  guard let file = URL(string: response.uri), FileManager.default.fileExists(atPath: file.path), response.maxCopyBytes <= nativeCopyBytes else { failProbe(4) }
}
var uploaded: [String: Any] = [:]
if mode.hasPrefix("upload"), let uri = result?.uri, let file = URL(string: uri),
  let data = try? Data(contentsOf: file), data.count <= 65_536,
  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { uploaded = json }
let released = DispatchSemaphore(value: 0)
var cleaned = false
store.release(id: id) { ok in cleaned = ok; released.signal() }
if released.wait(timeout: .now() + 10) == .timedOut || !cleaned { failProbe(5) }
let remaining = (try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("baro_native_transfers").path)) ?? []
var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
let wire: [String: Any] = [
  "success": result != nil, "status": result?.status ?? 0, "size": Double(result?.size ?? 0),
  "sha256": result?.sha256 ?? "", "maxCopyBytes": result?.maxCopyBytes ?? 0,
  "peakResidentBytes": usage.ru_maxrss, "remainingFiles": remaining.count,
  "setCookieReturned": result?.headers["set-cookie"] != nil,
  "responseCookieStored": HTTPCookieStorage.shared.cookies?.contains(where: { $0.name == "download_probe" }) ?? false,
  "errorCodeOnly": result?.body.contains("UNAUTHENTICATED") ?? false,
  "uploadedSize": uploaded["uploadedSize"] as? Int ?? 0,
  "uploadedHash": uploaded["uploadedHash"] as? String ?? "",
]
let data = try JSONSerialization.data(withJSONObject: wire, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
