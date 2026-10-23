import Foundation
import CryptoKit
import Darwin

let nativeCopyBytes = 65_536
private let errorBytes = 65_536
struct PrivateTransferFailure: Error {}
struct DiskTransferInput {
  let url: String
  let origin: String
  let method: String
  let headers: [String: String]
  let body: String?
  let maximum: Int64
  var upload: DiskUploadSource? = nil
}
struct DiskUploadSource { let sourceName: String; let byteLength: Int64; let contentHash: String }
struct DiskTransferResult {
  let status: Int
  let headers: [String: String]
  let size: Int64
  let sha256: String
  let uri: String
  let body: String
  let maxCopyBytes: Int
  func wire(fileId: String) -> [String: Any] { ["status": status, "headers": headers, "size": Double(size), "sha256": sha256, "fileId": uri.isEmpty ? "" : fileId, "body": body, "maxCopyBytes": maxCopyBytes] }
}
private let allowedRequestHeaders: Set<String> = ["cookie", "origin", "x-baro-expected-owner", "idempotency-key", "content-type", "accept", "if-match"]
private let allowedResponseHeaders: Set<String> = ["content-type", "content-length", "content-disposition", "content-encoding", "set-cookie", "etag"]

/** Foreground URLSession download writes to an OS file, never to a JS byte queue. */
final class DiskTransferStore: @unchecked Sendable {
  private let root: URL
  private let expectedOrigin: String?
  private let uploadRoot: URL
  private let lock = NSLock()
  private var jobs: [String: DiskTransferJob] = [:]
  private var clearing = false
  init(cacheRoot: URL, expectedOrigin: String? = nil) {
    root = cacheRoot.appendingPathComponent("baro_native_transfers", isDirectory: true); self.expectedOrigin = expectedOrigin
    let environment = expectedOrigin == "https://baro.site" ? "production" : expectedOrigin == "https://preview.baro.site" ? "preview" : "local"
    uploadRoot = cacheRoot.resolvingSymlinksInPath().appendingPathComponent("baro_\(environment)_private_uploads", isDirectory: true)
  }
  private func verifyRoot(create: Bool) throws {
    if !FileManager.default.fileExists(atPath: root.path) {
      if !create { return }
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else { throw PrivateTransferFailure() }
    #if os(iOS) || os(tvOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.path)
    #endif
  }
  func reserve() throws -> String {
    lock.lock(); defer { lock.unlock() }
    guard !clearing else { throw PrivateTransferFailure() }
    try verifyRoot(create: true)
    let id = UUID().uuidString.lowercased()
    let file = root.appendingPathComponent(id + ".bin")
    guard !FileManager.default.fileExists(atPath: file.path), !FileManager.default.fileExists(atPath: file.deletingPathExtension().appendingPathExtension("upload").path) else { throw PrivateTransferFailure() }
    jobs[id] = DiskTransferJob(file: file, uploadRoot: uploadRoot, expectedOrigin: expectedOrigin)
    return id
  }
  func download(id: String, input: DiskTransferInput, completion: @escaping (Result<DiskTransferResult, Error>) -> Void) {
    lock.lock(); let job = jobs[id]; lock.unlock()
    guard let job else { completion(.failure(PrivateTransferFailure())); return }
    job.start(input: input, completion: completion)
  }
  func cancel(id: String) {
    lock.lock(); let job = jobs[id]; lock.unlock(); job?.cancel()
  }
  /** Delete only after URLSession completion and file hashing have both ended. */
  func release(id: String, completion: @escaping (Bool) -> Void) {
    lock.lock(); let job = jobs[id]; lock.unlock()
    guard let job else { completion(true); return }
    job.cancel()
    job.whenFinished { [self] in
      do {
        if FileManager.default.fileExists(atPath: job.file.path) { try FileManager.default.removeItem(at: job.file) }
        if FileManager.default.fileExists(atPath: job.payload.path) { try FileManager.default.removeItem(at: job.payload) }
        lock.lock(); if jobs[id] === job { jobs.removeValue(forKey: id) }; lock.unlock()
        completion(true)
      } catch { completion(false) }
    }
  }
  func clear(completion: @escaping (Bool) -> Void) {
    lock.lock()
    guard !clearing else { lock.unlock(); completion(false); return }
    clearing = true; let ids = Array(jobs.keys); lock.unlock()
    ids.forEach { cancel(id: $0) }
    let group = DispatchGroup(), resultLock = NSLock()
    var success = true
    for id in ids {
      group.enter(); release(id: id) { ok in resultLock.lock(); success = success && ok; resultLock.unlock(); group.leave() }
    }
    group.notify(queue: .global(qos: .utility)) { [self] in
      do {
        try verifyRoot(create: false)
        if FileManager.default.fileExists(atPath: root.path) {
          for file in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) {
            let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            let name = file.lastPathComponent
            let suffix = name.hasSuffix(".bin") ? ".bin" : name.hasSuffix(".upload") ? ".upload" : ""
            guard !suffix.isEmpty, let id = UUID(uuidString: String(name.dropLast(suffix.count))), id.uuidString.lowercased() == String(name.dropLast(suffix.count)),
              values.isRegularFile == true, values.isSymbolicLink != true else { throw PrivateTransferFailure() }
            try FileManager.default.removeItem(at: file)
          }
        }
      } catch { success = false }
      lock.lock(); clearing = false; lock.unlock(); completion(success)
    }
  }
  func close() { lock.lock(); let active = Array(jobs.values); lock.unlock(); active.forEach { $0.cancel() } }
}

private final class DiskTransferJob: NSObject, URLSessionDownloadDelegate, URLSessionDataDelegate, @unchecked Sendable {
  let file: URL
  let payload: URL
  private let uploadRoot: URL
  private let expectedOrigin: String?
  private let lock = NSLock()
  private var started = false, canceled = false, finished = false
  private var input: DiskTransferInput?
  private var completion: ((Result<DiskTransferResult, Error>) -> Void)?
  private var waiters: [() -> Void] = []
  private var session: URLSession?
  private var task: URLSessionTask?
  private var staged: DiskTransferResult?
  private var responseSink: FileHandle?, uploadResponse: HTTPURLResponse?
  private var responseSize: Int64 = 0, uploadCopy = 0
  init(file: URL, uploadRoot: URL, expectedOrigin: String?) {
    self.file = file; self.payload = file.deletingPathExtension().appendingPathExtension("upload")
    self.uploadRoot = uploadRoot; self.expectedOrigin = expectedOrigin
  }
  func start(input: DiskTransferInput, completion: @escaping (Result<DiskTransferResult, Error>) -> Void) {
    lock.lock()
    guard !started && !canceled && !finished else { lock.unlock(); completion(.failure(PrivateTransferFailure())); return }
    started = true; self.input = input; self.completion = completion; lock.unlock()
    DispatchQueue.global(qos: .utility).async { [self] in prepare(input) }
  }
  private func prepare(_ input: DiskTransferInput) {
    do {
      let url = try validate(input, expectedOrigin: expectedOrigin)
      if let upload = input.upload { try stageUpload(upload) }
      try ensure()
      let config = URLSessionConfiguration.ephemeral
      config.httpCookieStorage = nil; config.httpShouldSetCookies = false
      config.urlCredentialStorage = nil; config.urlCache = nil
      config.requestCachePolicy = .reloadIgnoringLocalCacheData
      config.waitsForConnectivity = false
      let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
      var request = URLRequest(url: url)
      request.httpMethod = input.method; request.httpShouldHandleCookies = false
      for (name, value) in input.headers { request.setValue(value, forHTTPHeaderField: name) }
      request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
      if let body = input.body { request.httpBody = Data(body.utf8) }
      let task: URLSessionTask = input.upload == nil ? session.downloadTask(with: request) : session.uploadTask(with: request, fromFile: payload)
      lock.lock()
      if canceled { lock.unlock(); session.invalidateAndCancel(); finish(.failure(PrivateTransferFailure())); return }
      self.session = session; self.task = task; lock.unlock(); task.resume()
    } catch { finish(.failure(PrivateTransferFailure())) }
  }
  func cancel() {
    lock.lock(); canceled = true; let task = task; let neverStarted = !started; lock.unlock()
    task?.cancel()
    if neverStarted { finish(.failure(PrivateTransferFailure())) }
  }
  func whenFinished(_ callback: @escaping () -> Void) {
    lock.lock(); if finished { lock.unlock(); callback() } else { waiters.append(callback); lock.unlock() }
  }
  private func ensure() throws { lock.lock(); let invalid = canceled || finished; lock.unlock(); if invalid { throw PrivateTransferFailure() } }
  private func finish(_ result: Result<DiskTransferResult, Error>) {
    lock.lock()
    guard !finished else { lock.unlock(); return }
    let accepted: Result<DiskTransferResult, Error> = canceled ? .failure(PrivateTransferFailure()) : result
    try? responseSink?.close(); responseSink = nil
    try? FileManager.default.removeItem(at: payload)
    // Mark finished only after IO in didFinishDownloading has returned on the serial delegate queue.
    if case .failure = accepted { try? FileManager.default.removeItem(at: file) }
    finished = true
    let callback = completion, ready = waiters, session = session
    completion = nil; waiters.removeAll(); self.session = nil; task = nil; input = nil; staged = nil
    lock.unlock()
    session?.finishTasksAndInvalidate(); callback?(accepted); ready.forEach { $0() }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil); cancel()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust { completionHandler(.performDefaultHandling, nil) }
    else { completionHandler(.cancelAuthenticationChallenge, nil) }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    guard let input = input, let response = downloadTask.response as? HTTPURLResponse else { cancel(); return }
    let maximum = (200..<300).contains(response.statusCode) ? input.maximum : Int64(errorBytes)
    if totalBytesWritten > maximum { cancel() }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    do {
      try ensure()
      guard let input = input, let response = downloadTask.response as? HTTPURLResponse,
        response.url == URL(string: input.url), !(300..<400).contains(response.statusCode) else { throw PrivateTransferFailure() }
      var headers: [String: String] = [:]
      for name in allowedResponseHeaders {
        guard let text = response.value(forHTTPHeaderField: name) else { continue }
        guard text.utf8.count <= 32_768 else { throw PrivateTransferFailure() }
        headers[name] = text
      }
      if !(200..<300).contains(response.statusCode) {
        let size = try location.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? -1
        guard (0...errorBytes).contains(size) else { throw PrivateTransferFailure() }
        let bytes = try Data(contentsOf: location)
        staged = DiskTransferResult(status: response.statusCode, headers: headers, size: 0, sha256: "", uri: "", body: String(decoding: bytes, as: UTF8.self), maxCopyBytes: min(size, nativeCopyBytes))
        return
      }
      // The OS download file is moved without a JS/body copy, then independently hashed in a fixed buffer.
      guard !FileManager.default.fileExists(atPath: file.path) else { throw PrivateTransferFailure() }
      try FileManager.default.moveItem(at: location, to: file)
      #if os(iOS) || os(tvOS)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
      #endif
      let (size, hash, maximumRead) = try fingerprint(maximum: input.maximum)
      let encoding = headers["content-encoding"]?.trimmingCharacters(in: .whitespaces).lowercased()
      if encoding == nil || encoding == "" || encoding == "identity", let length = headers["content-length"] {
        guard length.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil, Int64(length) == size else { throw PrivateTransferFailure() }
      }
      try ensure()
      staged = DiskTransferResult(status: response.statusCode, headers: headers, size: size, sha256: hash, uri: file.absoluteString, body: "", maxCopyBytes: maximumRead)
    } catch { staged = nil }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if input?.upload != nil, error == nil {
      do {
        try responseSink?.close(); responseSink = nil
        try ensure()
        guard let response = uploadResponse else { throw PrivateTransferFailure() }
        let headers = try responseHeaders(response)
        if (200..<300).contains(response.statusCode) {
          let (size, hash, maximumRead) = try fingerprint(maximum: Int64(errorBytes))
          staged = DiskTransferResult(status: response.statusCode, headers: headers, size: size, sha256: hash, uri: file.absoluteString, body: "", maxCopyBytes: max(uploadCopy, maximumRead))
        } else {
          let data = try Data(contentsOf: file)
          guard data.count <= errorBytes else { throw PrivateTransferFailure() }
          staged = DiskTransferResult(status: response.statusCode, headers: headers, size: 0, sha256: "", uri: "", body: String(decoding: data, as: UTF8.self), maxCopyBytes: max(uploadCopy, data.count))
        }
      } catch { staged = nil }
    }
    if error == nil, let staged = staged { finish(.success(staged)) }
    else { finish(.failure(PrivateTransferFailure())) }
  }
  // Upload task response data is bounded native metadata; never accumulated by a completion-handler Data buffer.
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    do {
      try ensure()
      guard input?.upload != nil, let response = response as? HTTPURLResponse,
        response.url == URL(string: input?.url ?? ""), !(300..<400).contains(response.statusCode),
        response.expectedContentLength <= Int64(errorBytes) else { throw PrivateTransferFailure() }
      _ = try responseHeaders(response)
      let fd = Darwin.open(file.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
      guard fd >= 0 else { throw PrivateTransferFailure() }
      responseSink = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
      try protect(file)
      uploadResponse = response
      completionHandler(.allow)
    } catch { completionHandler(.cancel); cancel() }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    do {
      try ensure()
      guard let sink = responseSink, responseSize + Int64(data.count) <= Int64(errorBytes) else { throw PrivateTransferFailure() }
      try sink.write(contentsOf: data); responseSize += Int64(data.count)
    } catch { cancel() }
  }
  private func stageUpload(_ upload: DiskUploadSource) throws {
    let rootValues = try uploadRoot.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    let source = uploadRoot.appendingPathComponent(upload.sourceName)
    let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard rootValues.isDirectory == true, rootValues.isSymbolicLink != true,
      uploadRoot.resolvingSymlinksInPath() == uploadRoot.standardizedFileURL,
      values.isRegularFile == true, values.isSymbolicLink != true, values.fileSize == Int(upload.byteLength),
      let stream = InputStream(url: source) else { throw PrivateTransferFailure() }
    let fd = Darwin.open(payload.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
    guard fd >= 0 else { throw PrivateTransferFailure() }
    let output = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    stream.open(); defer { stream.close(); try? output.close() }
    try protect(payload)
    var hash = SHA256(), buffer = [UInt8](repeating: 0, count: nativeCopyBytes), size: Int64 = 0
    while true {
      try ensure()
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count == 0 { break }
      guard count > 0, size + Int64(count) <= upload.byteLength else { throw PrivateTransferFailure() }
      let data = Data(buffer.prefix(count)); try output.write(contentsOf: data); hash.update(data: data)
      size += Int64(count); uploadCopy = max(uploadCopy, count)
    }
    guard size == upload.byteLength, hash.finalize().map({ String(format: "%02x", $0) }).joined() == upload.contentHash else { throw PrivateTransferFailure() }
  }
  private func protect(_ url: URL) throws {
    #if os(iOS) || os(tvOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    #endif
  }
  private func responseHeaders(_ response: HTTPURLResponse) throws -> [String: String] {
    var headers: [String: String] = [:]
    for name in allowedResponseHeaders {
      if let value = response.value(forHTTPHeaderField: name) {
        guard value.utf8.count <= 32_768 else { throw PrivateTransferFailure() }
        headers[name] = value
      }
    }
    return headers
  }
  private func fingerprint(maximum: Int64) throws -> (Int64, String, Int) {
    guard let stream = InputStream(url: file) else { throw PrivateTransferFailure() }
    stream.open(); defer { stream.close() }
    var hash = SHA256(), buffer = [UInt8](repeating: 0, count: nativeCopyBytes), size: Int64 = 0, maxRead = 0
    while true {
      try ensure()
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count == 0 { break }
      guard count > 0, size + Int64(count) <= maximum else { throw PrivateTransferFailure() }
      buffer.withUnsafeBytes { bytes in hash.update(bufferPointer: UnsafeRawBufferPointer(start: bytes.baseAddress, count: count)) }
      size += Int64(count); maxRead = max(maxRead, count)
    }
    guard size > 0, (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize) == Int(size) else { throw PrivateTransferFailure() }
    return (size, hash.finalize().map { String(format: "%02x", $0) }.joined(), maxRead)
  }
}

private func effectivePort(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
private func allowedOrigin(_ url: URL, expectedOrigin: String?) -> Bool {
  let host = (url.host ?? "").lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
  if expectedOrigin != nil { return url.scheme == "https" && effectivePort(url) == 443 && ["baro.site", "preview.baro.site"].contains(host) }
  guard ["http", "https"].contains(url.scheme ?? "") else { return false }
  if ["localhost", "127.0.0.1", "::1"].contains(host) { return true }
  let parts = host.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
  return parts.count == 4 && parts.allSatisfy { (0...255).contains($0) } && (parts[0] == 10 || parts[0] == 192 && parts[1] == 168 || parts[0] == 172 && (16...31).contains(parts[1]))
}
private func validate(_ input: DiskTransferInput, expectedOrigin: String?) throws -> URL {
  guard let url = URL(string: input.url), let origin = URL(string: input.origin), url.user == nil, url.password == nil, url.fragment == nil,
    origin.user == nil, origin.password == nil, origin.fragment == nil, origin.query == nil, ["", "/"].contains(origin.path),
    url.path.hasPrefix("/api/"), url.scheme == origin.scheme, url.host?.lowercased() == origin.host?.lowercased(),
    effectivePort(url) == effectivePort(origin), allowedOrigin(url, expectedOrigin: expectedOrigin),
    expectedOrigin == nil || input.origin == expectedOrigin,
    !url.path.contains("\\"), !url.path.components(separatedBy: "/").contains(where: { $0 == "." || $0 == ".." }), ["GET", "POST", "PUT"].contains(input.method),
    input.maximum > 0 && input.maximum <= 9_007_199_254_740_991, (input.body?.utf8.count ?? 0) <= 65_536,
    input.method != "GET" || input.body == nil else { throw PrivateTransferFailure() }
  var lower: [String: String] = [:]
  for (name, value) in input.headers {
    let key = name.lowercased()
    guard lower[key] == nil, allowedRequestHeaders.contains(key), name.utf8.count <= 64, value.utf8.count <= 32_768,
      !value.contains("\r"), !value.contains("\n"), !value.contains("\0") else { throw PrivateTransferFailure() }
    lower[key] = value
  }
  guard lower["origin"] == input.origin else { throw PrivateTransferFailure() }
  if input.method == "PUT" {
    guard let upload = input.upload, input.body == nil, input.maximum == Int64(errorBytes), url.query == nil,
      url.path.range(of: "^/api/v2/me/lawyer/assets/[A-Za-z0-9_-]{1,128}/content$", options: .regularExpression) != nil,
      let id = UUID(uuidString: upload.sourceName), id.uuidString.lowercased() == upload.sourceName,
      (1...100_000_000).contains(upload.byteLength), upload.contentHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      lower["content-type"] == "application/octet-stream", lower["if-match"]?.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil else { throw PrivateTransferFailure() }
  } else if input.upload != nil { throw PrivateTransferFailure() }
  return url
}
