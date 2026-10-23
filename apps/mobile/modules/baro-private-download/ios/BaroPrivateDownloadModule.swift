import ExpoModulesCore

private struct DownloadInput: Record {
  @Field var url: String = ""
  @Field var origin: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String? = nil
  @Field var maximum: Double = 0
}
private struct UploadInput: Record {
  @Field var url: String = ""
  @Field var origin: String = ""
  @Field var headers: [String: String] = [:]
  @Field var sourceName: String = ""
  @Field var byteLength: Double = 0
  @Field var contentHash: String = ""
}
public final class BaroPrivateDownloadModule: Module {
  private static let sharedLock = NSLock()
  private static var shared: DiskTransferStore?
  private let ownedLock = NSLock()
  private var owned: Set<String> = []
  private var retired = false
  private func store() throws -> DiskTransferStore {
    Self.sharedLock.lock(); defer { Self.sharedLock.unlock() }
    if let shared = Self.shared { return shared }
    guard let cache = appContext?.config.cacheDirectory else { throw PrivateTransferFailure() }
    let origin: String?
    switch Bundle.main.bundleIdentifier {
    case "site.baro.app": origin = "https://baro.site"
    case "site.baro.app.preview": origin = "https://preview.baro.site"
    case "site.baro.app.dev": origin = nil
    default: throw PrivateTransferFailure()
    }
    let created = DiskTransferStore(cacheRoot: cache, expectedOrigin: origin); Self.shared = created; return created
  }
  public func definition() -> ModuleDefinition {
    Name("BaroPrivateDownload")
    Function("reserve") { () -> String in
      self.ownedLock.lock(); defer { self.ownedLock.unlock() }
      do {
        guard !self.retired else { throw PrivateTransferFailure() }
        let id = try self.store().reserve(); self.owned.insert(id); return id
      } catch { throw Exception(name: "PrivateDownloadFailure", description: "PRIVATE_DOWNLOAD_FAILED", code: "PRIVATE_DOWNLOAD_FAILED") }
    }
    Function("cancel") { (id: String) in
      self.ownedLock.lock(); let owns = self.owned.contains(id); self.ownedLock.unlock()
      do { if owns { try self.store().cancel(id: id) } }
      catch { throw Exception(name: "PrivateDownloadFailure", description: "PRIVATE_DOWNLOAD_FAILED", code: "PRIVATE_DOWNLOAD_FAILED") }
    }
    AsyncFunction("download") { (id: String, input: DownloadInput, promise: Promise) in
      self.ownedLock.lock(); let owns = !self.retired && self.owned.contains(id); self.ownedLock.unlock()
      guard owns, input.maximum.isFinite, input.maximum.rounded(.towardZero) == input.maximum,
        input.maximum >= 1, input.maximum <= 9_007_199_254_740_991 else { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED"); return }
      do {
        try self.store().download(id: id, input: DiskTransferInput(url: input.url, origin: input.origin, method: input.method, headers: input.headers, body: input.body, maximum: Int64(input.maximum))) { result in
          switch result {
          case .success(let value): promise.resolve(value.wire(fileId: id))
          case .failure: promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED")
          }
        }
      } catch { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED") }
    }
    AsyncFunction("upload") { (id: String, input: UploadInput, promise: Promise) in
      self.ownedLock.lock(); let owns = !self.retired && self.owned.contains(id); self.ownedLock.unlock()
      guard owns, input.byteLength.isFinite, input.byteLength.rounded(.towardZero) == input.byteLength,
        input.byteLength >= 1, input.byteLength <= 100_000_000 else { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED"); return }
      do {
        try self.store().download(id: id, input: DiskTransferInput(url: input.url, origin: input.origin, method: "PUT", headers: input.headers, body: nil, maximum: 65_536, upload: DiskUploadSource(sourceName: input.sourceName, byteLength: Int64(input.byteLength), contentHash: input.contentHash))) { result in
          switch result {
          case .success(let value): promise.resolve(value.wire(fileId: id))
          case .failure: promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED")
          }
        }
      } catch { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED") }
    }
    AsyncFunction("release") { (id: String, promise: Promise) in
      self.ownedLock.lock(); let owns = self.owned.contains(id); self.ownedLock.unlock()
      guard owns else { promise.resolve(nil); return }
      do { try self.store().release(id: id) { ok in
        if ok { self.ownedLock.lock(); self.owned.remove(id); self.ownedLock.unlock(); promise.resolve(nil) } else { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED") }
      } } catch { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED") }
    }
    AsyncFunction("clear") { (promise: Promise) in
      do { try self.store().clear { ok in
        if ok { promise.resolve(nil) } else { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED") }
      } } catch { promise.reject("PRIVATE_DOWNLOAD_FAILED", "PRIVATE_DOWNLOAD_FAILED") }
    }
    OnDestroy {
      self.ownedLock.lock(); self.retired = true; let ids = Array(self.owned); self.ownedLock.unlock()
      Self.sharedLock.lock(); let store = Self.shared; Self.sharedLock.unlock()
      ids.forEach { store?.cancel(id: $0) }
    }
  }
}
