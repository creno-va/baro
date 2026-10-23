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
    @Volatile var badCookie = false
    @Volatile private var alive = true
    private val workers = Executors.newFixedThreadPool(4) { task -> Thread(task).apply { isDaemon = true } }
    init { Thread {
      while (alive) try { val client = socket.accept(); workers.submit { client.use { connection ->
        try {
          val input = connection.getInputStream().bufferedReader()
          val first = input.readLine() ?: return@use
          val path = first.split(' ')[1]
          val headers = mutableMapOf<String, String>()
          while (true) { val line = input.readLine() ?: break; if (line.isEmpty()) break; val parts = line.split(':', limit = 2); headers[parts[0].lowercase()] = parts[1].trim() }
          val length = headers["content-length"]?.toIntOrNull() ?: 0
          val body = CharArray(length); if (length > 0) input.read(body)
          requests.incrementAndGet()
          if ((headers["cookie"] ?: "") != if (path.startsWith("/api/jar")) "" else "baro_probe=synthetic_explicit") badCookie = true
          val output = connection.getOutputStream()
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
  @Test fun cleanupNeverDeletesAnUnexpectedFile() = fixture { _, store, directory ->
    val id = store.reserve(); store.release(id)
    val foreign = File(directory, "baro_native_transfers/foreign.txt"); foreign.writeText("synthetic unrelated file")
    try { store.clear(); fail("UNEXPECTED_FILE_WAS_ACCEPTED") } catch (_: TransferFailure) { assertTrue(foreign.exists()) } finally { foreign.delete() }
    val orphan = File(directory, "baro_native_transfers/${java.util.UUID.randomUUID()}.bin"); orphan.writeText("synthetic abandoned transfer")
    store.clear(); assertFalse(orphan.exists())
  }
}
