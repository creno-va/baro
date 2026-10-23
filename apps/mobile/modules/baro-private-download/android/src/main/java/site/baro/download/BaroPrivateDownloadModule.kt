package site.baro.download

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

class DownloadInput : Record {
  @Field var url: String = ""
  @Field var origin: String = ""
  @Field var method: String = "GET"
  @Field var headers: Map<String, String> = emptyMap()
  @Field var body: String? = null
  @Field var maximum: Double = 0.0
}
class UploadInput : Record {
  @Field var url: String = ""
  @Field var origin: String = ""
  @Field var headers: Map<String, String> = emptyMap()
  @Field var sourceName: String = ""
  @Field var byteLength: Double = 0.0
  @Field var contentHash: String = ""
}
private class PrivateDownloadException : CodedException("PRIVATE_DOWNLOAD_FAILED")
class BaroPrivateDownloadModule : Module() {
  companion object {
    private val sharedLock = Any()
    private var shared: DiskTransferStore? = null
  }
  @Volatile private var retired = false
  private val owned = ConcurrentHashMap.newKeySet<String>()
  private fun store(): DiskTransferStore = synchronized(sharedLock) {
    shared ?: run {
      val origin = when (appContext.reactContext?.packageName) {
        "site.baro.app" -> "https://baro.site"
        "site.baro.app.preview" -> "https://preview.baro.site"
        "site.baro.app.dev" -> null
        else -> throw PrivateDownloadException()
      }
      DiskTransferStore(appContext.cacheDirectory, origin).also { shared = it }
    }
  }
  override fun definition() = ModuleDefinition {
    Name("BaroPrivateDownload")
    Function("reserve") { try { synchronized(this) { if (retired) throw PrivateDownloadException(); store().reserve().also { owned.add(it) } } } catch (_: Exception) { throw PrivateDownloadException() } }
    Function("cancel") { id: String -> try { if (owned.contains(id)) store().cancel(id); Unit } catch (_: Exception) { throw PrivateDownloadException() } }
    AsyncFunction("download") Coroutine { id: String, input: DownloadInput ->
      withContext(Dispatchers.IO) {
        try {
          if (retired || !owned.contains(id) || !input.maximum.isFinite() || input.maximum % 1.0 != 0.0 || input.maximum !in 1.0..9007199254740991.0) throw TransferFailure()
          store().download(id, TransferRequest(input.url, input.origin, input.method, input.headers, input.body, input.maximum.toLong())).wire(id)
        } catch (_: Exception) { throw PrivateDownloadException() }
      }
    }
    AsyncFunction("upload") Coroutine { id: String, input: UploadInput ->
      withContext(Dispatchers.IO) {
        try {
          if (retired || !owned.contains(id) || !input.byteLength.isFinite() || input.byteLength % 1.0 != 0.0 || input.byteLength !in 1.0..100000000.0) throw TransferFailure()
          store().download(id, TransferRequest(input.url, input.origin, "PUT", input.headers, null, 65536, TransferUpload(input.sourceName, input.byteLength.toLong(), input.contentHash))).wire(id)
        } catch (_: Exception) { throw PrivateDownloadException() }
      }
    }
    AsyncFunction("release") Coroutine { id: String -> withContext(Dispatchers.IO) {
      try { if (owned.contains(id)) { store().release(id); owned.remove(id) }; Unit } catch (_: Exception) { throw PrivateDownloadException() }
    } }
    AsyncFunction("clear") Coroutine { -> withContext(Dispatchers.IO) {
      try { store().clear() } catch (_: Exception) { throw PrivateDownloadException() }
    } }
    OnDestroy {
      val ids = synchronized(this) { retired = true; owned.toList() }
      val previous = synchronized(sharedLock) { shared }
      ids.forEach { id -> previous?.cancel(id) }
    }
  }
}
