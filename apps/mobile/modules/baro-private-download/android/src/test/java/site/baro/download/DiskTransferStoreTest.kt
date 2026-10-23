package site.baro.download

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.CookieHandler
import java.net.CookieManager
import java.net.HttpCookie
import java.net.ServerSocket
import java.net.SocketException
import java.net.URI
import java.nio.file.Files
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.GZIPOutputStream

class DiskTransferStoreTest {
  private val pattern = ByteArray(65536) { (it % 251).toByte() }
  private inner class Server : AutoCloseable {
    val socket = ServerSocket(0)
    val origin = "http://127.0.0.1:${socket.localPort}"
    val requests = AtomicInteger()
    @Volatile var uploadedSize = 0L
    @Volatile var uploadedHash = ""
    @Volatile var badCookie = false
    @Volatile private var alive = true
    private val workers = Executors.newFixedThreadPool(4) { task -> Thread(task).apply { isDaemon = true } }
    init { Thread {
      while (alive) try { val client = socket.accept(); workers.submit { client.use { connection ->
        try {
          val input = connection.getInputStream()
          fun line(): String? {
            val text = StringBuilder()
            while (true) { val byte = input.read(); if (byte == -1) return null; if (byte == 10) return text.toString().removeSuffix("\r"); if (text.length >= 65536) throw AssertionError("SYNTHETIC_HEADER_LIMIT"); text.append(byte.toChar()) }
          }
          val first = line() ?: return@use
          val path = first.split(' ')[1]
          val headers = mutableMapOf<String, String>()
          while (true) { val header = line() ?: break; if (header.isEmpty()) break; val parts = header.split(':', limit = 2); headers[parts[0].lowercase()] = parts[1].trim() }
          val length = headers["content-length"]?.toLongOrNull() ?: 0
          requests.incrementAndGet()
          if ((headers["cookie"] ?: "") != if (path.startsWith("/api/jar")) "" else "baro_probe=synthetic_explicit") badCookie = true
          val output = connection.getOutputStream()
          if (first.startsWith("PUT ")) {
            if (headers["if-match"] != "7" || headers["content-type"] != "application/octet-stream") throw AssertionError("SYNTHETIC_UPLOAD_HEADERS")
            if (path.contains("asset_slow")) Thread.sleep(1500)
            val hash = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(65536); var size = 0L
            while (size < length) { val count = input.read(buffer, 0, minOf(buffer.size.toLong(), length - size).toInt()); if (count <= 0) return@use; hash.update(buffer, 0, count); size += count }
            uploadedSize = size; uploadedHash = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
            if (path.contains("asset_redirect")) { output.write("HTTP/1.1 307 Temporary Redirect\r\nLocation: $origin/api/target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); return@use }
            val error = path.contains("asset_error")
            val body = if (error) "{\"error\":{\"code\":\"UNAUTHENTICATED\"}}" else if (path.contains("asset_oversize")) "x".repeat(65537) else "{\"uploadedSize\":$size,\"uploadedHash\":\"$uploadedHash\"}"
            val status = if (error) "401 Unauthorized" else "200 OK"
            output.write("HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nSet-Cookie: download_probe=synthetic; Path=/\r\nConnection: close\r\n\r\n".toByteArray()); output.write(body.toByteArray()); return@use
          }
          val body = ByteArray(length.toInt()); var read = 0
          while (read < body.size) { val count = input.read(body, read, body.size - read); if (count <= 0) return@use; read += count }
          if (path.startsWith("/api/redirect")) { output.write("HTTP/1.1 307 Temporary Redirect\r\nLocation: $origin/api/target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); output.flush(); return@use }
          if (path.startsWith("/api/error")) {
            val error = "{\"error\":{\"code\":\"UNAUTHENTICATED\"}}".toByteArray()
            output.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: ${error.size}\r\nSet-Cookie: download_probe=synthetic; Path=/\r\nConnection: close\r\n\r\n".toByteArray()); output.write(error); return@use
          }
          if (path.startsWith("/api/post") && (first.split(' ')[0] != "POST" || String(body) != "{\"selectedFileIds\":[\"synthetic_file\"]}")) throw AssertionError("SYNTHETIC_POST_CHANGED")
          if (path.startsWith("/api/gzip")) {
            val bytes = ByteArrayOutputStream(); GZIPOutputStream(bytes).use { it.write(pattern) }
            val gzip = bytes.toByteArray()
            output.write("HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${gzip.size}\r\nConnection: close\r\n\r\n".toByteArray()); output.write(gzip); return@use
          }
          val size = path.substringAfter("size=", "1000").toLong()
          output.write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: $size\r\nSet-Cookie: download_probe=synthetic; Path=/\r\nConnection: close\r\n\r\n".toByteArray())
          var sent = 0L
          while (sent < size) { val count = minOf(pattern.size.toLong(), size - sent).toInt(); output.write(pattern, 0, count); sent += count; if (path.startsWith("/api/slow")) { output.flush(); Thread.sleep(4) } }
        } catch (_: Exception) { /* Expected cancellation/broken pipe has no diagnostics or inputs in logs. */ }
      } } } catch (_: SocketException) { if (alive) throw AssertionError("SERVER_SOCKET_FAILED") }
    }.apply { isDaemon = true }.start() }
    override fun close() { alive = false; socket.close(); workers.shutdownNow(); workers.awaitTermination(5, TimeUnit.SECONDS) }
  }
  private fun request(server: Server, path: String, maximum: Long = 1000000000) = TransferRequest(server.origin + path, server.origin, "GET", mapOf("origin" to server.origin, "cookie" to "baro_probe=synthetic_explicit"), null, maximum)
  private inline fun fixture(block: (Server, DiskTransferStore, File) -> Unit) {
    val directory = Files.createTempDirectory("baro-native-jvm-").toFile()
    Server().use { server -> val store = DiskTransferStore(directory)
      try { block(server, store, directory) } finally { store.clear(); store.close(); directory.deleteRecursively() }
      assertFalse(server.badCookie)
    }
  }
  private fun failed(store: DiskTransferStore, request: TransferRequest) {
    val id = store.reserve()
    try { store.download(id, request); fail("EXPECTED_PRIVATE_TRANSFER_REJECTION") } catch (_: TransferFailure) {} finally { store.release(id) }
  }
  @Test fun supportedLargeBytesFit128MiBHeapAndHaveIndependentKnownHash() = fixture { server, store, directory ->
    for ((size, hash) in listOf(100000000L to "bae11d0911dfe120745abe9a7fb286c5405a411712e71a2fbf00bbcb74a78313", 1000000000L to "e229df588ad97c9c398bfb6106483fb2672bb440f022ad8861ed7a149270cb35")) {
      val id = store.reserve(); val result = store.download(id, request(server, "/api/bytes?size=$size", size))
      assertEquals(size, result.size); assertEquals(hash, result.sha256); assertTrue(result.maxCopyBytes <= 65536)
      assertTrue(Runtime.getRuntime().maxMemory() <= 128L * 1024 * 1024)
      println("{\"platform\":\"JVM-native-core\",\"size\":$size,\"maxCopyBytes\":${result.maxCopyBytes},\"maxHeapBytes\":${Runtime.getRuntime().maxMemory()},\"appDeviceAcceptance\":false}")
      assertTrue(File(URI(result.uri)).exists()); store.release(id)
      assertEquals(0, File(directory, "baro_native_transfers").listFiles()?.size)
    }
  }
  @Test fun redirectCookieIsolationAndResponseCookieAreExplicit() = fixture { server, store, _ ->
    val previous = CookieHandler.getDefault(); val manager = CookieManager()
    manager.cookieStore.add(URI(server.origin), HttpCookie("ambient_probe", "synthetic_ambient"))
    CookieHandler.setDefault(manager)
    try {
      val id = store.reserve(); val result = store.download(id, request(server, "/api/jar").copy(headers = mapOf("origin" to server.origin)))
      assertTrue(result.headers["set-cookie"]?.contains("download_probe") == true); store.release(id)
      assertEquals(1, manager.cookieStore.cookies.size)
      val before = server.requests.get(); failed(store, request(server, "/api/redirect")); assertEquals(before + 1, server.requests.get())
    } finally { CookieHandler.setDefault(previous) }
  }
  @Test fun preCancelActiveCancelAndClearWaitForDescriptorCleanup() = fixture { server, store, directory ->
    val first = store.reserve(); store.cancel(first)
    try { store.download(first, request(server, "/api/bytes")); fail("PRE_CANCELED_DISPATCH") } catch (_: TransferFailure) {} finally { store.release(first) }
    val worker = Executors.newSingleThreadExecutor(); val id = store.reserve()
    try {
      val done = worker.submit<Boolean> { try { store.download(id, request(server, "/api/slow?size=1000000000")); false } catch (_: TransferFailure) { true } }
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      while (server.requests.get() == 0 && System.nanoTime() < deadline) Thread.sleep(1)
      store.clear(); assertTrue(done.get(10, TimeUnit.SECONDS)); assertEquals(0, File(directory, "baro_native_transfers").listFiles()?.size)
      val next = store.reserve(); store.release(next)
    } finally { worker.shutdownNow() }
  }
  @Test fun bodySizeOriginHeadersAndMethodAreFencedBeforePublishing() = fixture { server, store, directory ->
    failed(store, request(server, "/api/bytes?size=1000000", 65536))
    failed(store, request(server, "/api/gzip", 1000))
    for (bad in listOf(
      request(server, "/not-api"), request(server, "/api/../bytes?size=1000"), request(server, "/api/%2e%2e/bytes?size=1000"), request(server, "/api/bytes").copy(url = "https://example.invalid/api/bytes", origin = "https://example.invalid", headers = mapOf("origin" to "https://example.invalid")),
      request(server, "/api/bytes").copy(origin = "https://baro.site"), request(server, "/api/bytes").copy(method = "DELETE"), request(server, "/api/bytes").copy(maximum = 0),
      request(server, "/api/bytes").copy(body = "not allowed"), request(server, "/api/bytes").copy(headers = mapOf("origin" to server.origin, "authorization" to "SYNTHETIC_TOKEN"))
    )) failed(store, bad)
    assertEquals(0, File(directory, "baro_native_transfers").listFiles()?.size)
    val previewOnly = DiskTransferStore(directory, "https://preview.baro.site")
    failed(previewOnly, request(server, "/api/bytes")); previewOnly.clear(); previewOnly.close()
  }
  @Test fun postErrorsAndGzipKeepMetadataAndByteIntegrity() = fixture { server, store, _ ->
    val post = store.reserve(); assertEquals(1000L, store.download(post, request(server, "/api/post").copy(method = "POST", body = "{\"selectedFileIds\":[\"synthetic_file\"]}")).size); store.release(post)
    val gzip = store.reserve(); val decoded = store.download(gzip, request(server, "/api/gzip")); assertEquals(65536L, decoded.size); assertEquals("4b640d85ab3ba30fd02c9fc9db4a8928f416322ad27022ea58a65aaee68a4df2", decoded.sha256); store.release(gzip)
    val error = store.reserve(); val result = store.download(error, request(server, "/api/error")); assertEquals(401, result.status); assertEquals(0L, result.size); assertEquals("", result.uri); assertTrue(result.body.contains("UNAUTHENTICATED")); store.release(error)
  }
  private fun makeSource(directory: File, size: Long): Pair<File, TransferUpload> {
    val root = File(directory, "baro_local_private_uploads"); root.mkdirs()
    val file = File(root, UUID.randomUUID().toString()); val hash = MessageDigest.getInstance("SHA-256")
    file.outputStream().use { output -> var written = 0L; while (written < size) { val count = minOf(pattern.size.toLong(), size - written).toInt(); output.write(pattern, 0, count); hash.update(pattern, 0, count); written += count } }
    return file to TransferUpload(file.name, size, hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) })
  }
  private fun uploadRequest(server: Server, source: TransferUpload, asset: String = "asset_a") = TransferRequest(server.origin + "/api/v2/me/lawyer/assets/$asset/content", server.origin, "PUT", mapOf("origin" to server.origin, "cookie" to "baro_probe=synthetic_explicit", "content-type" to "application/octet-stream", "if-match" to "7"), null, 65536, source)
  @Test fun supported100MBUploadUsesNativeSnapshotAndBoundedHeapWithIndependentServerHash() = fixture { server, store, directory ->
    val (source, upload) = makeSource(directory, 100000000L); val id = store.reserve()
    val result = store.download(id, uploadRequest(server, upload))
    assertEquals(200, result.status); assertTrue(result.size in 1..65536); assertEquals(65536, result.maxCopyBytes)
    assertEquals(100000000L, server.uploadedSize); assertEquals("bae11d0911dfe120745abe9a7fb286c5405a411712e71a2fbf00bbcb74a78313", server.uploadedHash)
    assertTrue(Runtime.getRuntime().maxMemory() <= 134217728)
    println("{\"platform\":\"JVM-native-upload-core\",\"size\":${server.uploadedSize},\"maxCopyBytes\":${result.maxCopyBytes},\"maxHeapBytes\":${Runtime.getRuntime().maxMemory()},\"appDeviceAcceptance\":false}")
    store.release(id); assertTrue(source.exists()); assertEquals(0, File(directory, "baro_native_transfers").listFiles()?.size)
  }
  @Test fun uploadSourceHashSizePathSymlinkOriginAndHeadersFailBeforeDispatch() = fixture { server, store, directory ->
    val (source, data) = makeSource(directory, 1000000L); val valid = uploadRequest(server, data)
    for (invalid in listOf(
      valid.copy(upload = data.copy(contentHash = "0".repeat(64))), valid.copy(upload = data.copy(byteLength = 1000001)),
      valid.copy(upload = data.copy(byteLength = 100000001)), valid.copy(upload = data.copy(sourceName = "../outside")),
      valid.copy(upload = data.copy(sourceName = data.sourceName.uppercase())), valid.copy(url = server.origin + "/api/other"),
      valid.copy(headers = valid.headers + ("authorization" to "synthetic_forbidden")), valid.copy(headers = valid.headers - "if-match"),
      valid.copy(method = "GET"), valid.copy(body = "invalid"), valid.copy(maximum = 65537)
    )) failed(store, invalid)
    val real = File(source.parentFile, UUID.randomUUID().toString()); source.renameTo(real); Files.createSymbolicLink(source.toPath(), real.toPath())
    failed(store, valid); assertEquals(0, server.requests.get()); assertTrue(source.exists())
  }
  @Test fun uploadCancelRedirectErrorOversizeAndClearPreserveCallerSource() = fixture { server, store, directory ->
    val (source, data) = makeSource(directory, 1000000L)
    failed(store, uploadRequest(server, data, "asset_redirect")); assertEquals(1, server.requests.get())
    failed(store, uploadRequest(server, data, "asset_oversize"))
    val error = store.reserve(); val result = store.download(error, uploadRequest(server, data, "asset_error")); assertEquals(401, result.status); assertTrue(result.body.contains("UNAUTHENTICATED")); store.release(error)
    val worker = Executors.newSingleThreadExecutor(); val id = store.reserve(); val before = server.requests.get()
    try {
      val done = worker.submit<Boolean> { try { store.download(id, uploadRequest(server, data, "asset_slow")); false } catch (_: TransferFailure) { true } }
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      while (server.requests.get() == before && System.nanoTime() < deadline) Thread.sleep(1)
      assertTrue(server.requests.get() > before); store.clear(); assertTrue(done.get(10, TimeUnit.SECONDS))
      assertTrue(source.exists()); assertEquals(0, File(directory, "baro_native_transfers").listFiles()?.size)
    } finally { worker.shutdownNow() }
  }
  @Test fun cleanupNeverDeletesAnUnexpectedFile() = fixture { _, store, directory ->
    val id = store.reserve(); store.release(id)
    val foreign = File(directory, "baro_native_transfers/foreign.txt"); foreign.writeText("synthetic unrelated file")
    try { store.clear(); fail("UNEXPECTED_FILE_WAS_ACCEPTED") } catch (_: TransferFailure) { assertTrue(foreign.exists()) } finally { foreign.delete() }
    val orphan = File(directory, "baro_native_transfers/${java.util.UUID.randomUUID()}.bin"); orphan.writeText("synthetic abandoned transfer")
    store.clear(); assertFalse(orphan.exists())
    val payload = File(directory, "baro_native_transfers/${UUID.randomUUID()}.upload"); payload.writeText("synthetic abandoned payload"); store.clear(); assertFalse(payload.exists())
  }
}
