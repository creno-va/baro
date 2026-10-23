package site.baro.download

import okhttp3.Authenticator
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

internal const val COPY_BYTES = 65536
private const val ERROR_BYTES = 65536
private val requestHeaders = setOf("cookie", "origin", "x-baro-expected-owner", "idempotency-key", "content-type", "accept", "if-match")
private val responseHeaders = setOf("content-type", "content-length", "content-disposition", "content-encoding", "set-cookie", "etag")
internal class TransferFailure : Exception("PRIVATE_DOWNLOAD_FAILED")
internal data class TransferUpload(val sourceName: String, val byteLength: Long, val contentHash: String)
internal data class TransferRequest(val url: String, val origin: String, val method: String, val headers: Map<String, String>, val body: String?, val maximum: Long, val upload: TransferUpload? = null)
internal data class TransferResult(val status: Int, val headers: Map<String, String>, val size: Long, val sha256: String, val uri: String, val body: String, val maxCopyBytes: Int) {
  fun wire(id: String): Map<String, Any> = mapOf("status" to status, "headers" to headers, "size" to size.toDouble(), "sha256" to sha256, "fileId" to if (uri.isNotEmpty()) id else "", "body" to body, "maxCopyBytes" to maxCopyBytes)
}
private class TransferJob(val file: File) {
  val payload = File(file.parentFile, file.name.removeSuffix(".bin") + ".upload")
  var uploadCopy = 0
  val done = CountDownLatch(1)
  var started = false
  var canceled = false
  var call: Call? = null
}

/** No response bytes cross JS. The same core runs the 1GB/128MiB JVM heap probe. */
internal class DiskTransferStore(cacheRoot: File, private val expectedOrigin: String? = null) {
  private val root = File(cacheRoot.canonicalFile, "baro_native_transfers")
  private val uploadRoot = File(cacheRoot.canonicalFile, when (expectedOrigin) {
    "https://baro.site" -> "baro_production_private_uploads"
    "https://preview.baro.site" -> "baro_preview_private_uploads"
    else -> "baro_local_private_uploads"
  })
  private val jobs = ConcurrentHashMap<String, TransferJob>()
  private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
    .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .cache(null).readTimeout(60, TimeUnit.SECONDS).build()

  private var clearing = false
  @Synchronized fun reserve(): String {
    if (clearing) throw TransferFailure()
    if (!root.exists() && !root.mkdirs()) throw TransferFailure()
    if (!root.isDirectory || root.canonicalPath != root.absolutePath) throw TransferFailure()
    val id = UUID.randomUUID().toString()
    val job = TransferJob(File(root, "$id.bin"))
    if (job.file.exists() || job.payload.exists() || jobs.putIfAbsent(id, job) != null) throw TransferFailure()
    return id
  }
  fun cancel(id: String) {
    val job = jobs[id] ?: return
    synchronized(job) {
      job.canceled = true
      job.call?.cancel()
      if (!job.started) job.done.countDown()
    }
  }
  /** Wait for native IO/descriptors before unlink. A moved/adopted file is no longer at this path. */
  fun release(id: String) {
    val job = jobs[id] ?: return
    cancel(id)
    job.done.await()
    for (file in listOf(job.file, job.payload)) {
      if (file.exists() && !file.delete()) throw TransferFailure()
      if (file.exists()) throw TransferFailure()
    }
    jobs.remove(id, job)
  }
  fun clear() {
    val ids = synchronized(this) {
      if (clearing) throw TransferFailure()
      clearing = true
      jobs.keys.toList()
    }
    try {
      ids.forEach(::cancel)
      ids.forEach(::release)
      if (root.exists()) {
        if (!root.isDirectory || root.canonicalPath != root.absolutePath) throw TransferFailure()
        val files = root.listFiles() ?: throw TransferFailure()
        for (file in files) {
          if (!ownedName(file.name) || file.isDirectory || file.canonicalPath != file.absolutePath || !file.delete()) throw TransferFailure()
        }
      }
    } finally { synchronized(this) { clearing = false } }
  }
  fun close() { jobs.keys.toList().forEach(::cancel) }

  fun download(id: String, input: TransferRequest): TransferResult {
    val job = jobs[id] ?: throw TransferFailure()
    synchronized(job) {
      if (job.started || job.canceled) throw TransferFailure()
      job.started = true
    }
    var successful = false
    try {
      validate(input)
      val builder = Request.Builder().url(input.url).header("Accept-Encoding", "identity")
      for ((name, value) in input.headers) builder.header(name, value)
      if (input.method == "POST") builder.post((input.body ?: "").toRequestBody("application/json".toMediaType()))
      input.upload?.let { upload ->
        stageUpload(job, upload)
        builder.put(object : RequestBody() {
          override fun contentType() = "application/octet-stream".toMediaType()
          override fun contentLength() = upload.byteLength
          override fun isOneShot() = true
          override fun writeTo(sink: BufferedSink) {
            job.payload.inputStream().use { source ->
              val buffer = ByteArray(COPY_BYTES); var size = 0L
              while (true) {
                synchronized(job) { if (job.canceled) throw TransferFailure() }
                val count = source.read(buffer)
                if (count == -1) break
                if (count <= 0 || size + count > upload.byteLength) throw TransferFailure()
                sink.write(buffer, 0, count); size += count
              }
              if (size != upload.byteLength) throw TransferFailure()
            }
          }
        })
      }
      val call = client.newCall(builder.build())
      synchronized(job) {
        if (job.canceled) throw TransferFailure()
        job.call = call
      }
      val result = call.execute().use { response ->
        if (response.code in 300..399 || response.request.url.toString() != input.url) throw TransferFailure()
        val headers = responseHeaders.mapNotNull { name ->
          val values = response.headers.values(name)
          if (values.isEmpty()) null else name to values.joinToString(", ").also { if (it.length > 32768) throw TransferFailure() }
        }.toMap()
        val body = response.body ?: throw TransferFailure()
        val contentEncoding = headers["content-encoding"]?.trim()?.lowercase()
        val stream = when (contentEncoding) {
          null, "", "identity" -> body.byteStream()
          "gzip" -> GZIPInputStream(body.byteStream(), COPY_BYTES)
          else -> throw TransferFailure()
        }
        stream.use { source ->
          val maximum = if (response.isSuccessful) input.maximum else ERROR_BYTES.toLong()
          val buffer = ByteArray(COPY_BYTES)
          val digest = MessageDigest.getInstance("SHA-256")
          var size = 0L
          var maxCopy = 0
          if (!job.file.createNewFile()) throw TransferFailure()
          job.file.setReadable(false, false); job.file.setWritable(false, false)
          if (!job.file.setReadable(true, true) || !job.file.setWritable(true, true)) throw TransferFailure()
          job.file.outputStream().use { output ->
            while (true) {
              synchronized(job) { if (job.canceled) throw TransferFailure() }
              val count = source.read(buffer)
              if (count == -1) break
              if (count <= 0 || size + count > maximum) throw TransferFailure()
              output.write(buffer, 0, count); digest.update(buffer, 0, count)
              size += count; maxCopy = maxOf(maxCopy, count)
            }
          }
          if (response.isSuccessful) {
            if (size <= 0 || job.file.length() != size) throw TransferFailure()
            val length = headers["content-length"]
            if (contentEncoding.isNullOrBlank() || contentEncoding == "identity") {
              if (length != null && (!length.matches(Regex("[1-9][0-9]*")) || length.toLongOrNull() != size)) throw TransferFailure()
            }
            TransferResult(response.code, headers, size, digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }, job.file.toURI().toString(), "", maxCopy)
          } else {
            // Error bodies are bounded native-only metadata, never an original/body artifact.
            TransferResult(response.code, headers, 0, "", "", job.file.readText(Charsets.UTF_8), maxCopy)
          }
        }
      }
      synchronized(job) { if (job.canceled) throw TransferFailure() }
      successful = result.uri.isNotEmpty()
      return result.copy(maxCopyBytes = maxOf(result.maxCopyBytes, job.uploadCopy))
    } catch (_: Exception) {
      throw TransferFailure()
    } finally {
      synchronized(job) { job.call = null }
      if (!successful && job.file.exists()) job.file.delete()
      if (job.payload.exists()) job.payload.delete()
      job.done.countDown()
    }
  }
  private fun stageUpload(job: TransferJob, upload: TransferUpload) {
    if (!uploadRoot.isDirectory || uploadRoot.canonicalPath != uploadRoot.absolutePath) throw TransferFailure()
    val source = File(uploadRoot, upload.sourceName)
    if (!source.isFile || source.canonicalPath != source.absolutePath || source.length() != upload.byteLength || !job.payload.createNewFile()) throw TransferFailure()
    job.payload.setReadable(false, false); job.payload.setWritable(false, false)
    if (!job.payload.setReadable(true, true) || !job.payload.setWritable(true, true)) throw TransferFailure()
    val hash = MessageDigest.getInstance("SHA-256"); var size = 0L
    source.inputStream().use { input -> job.payload.outputStream().use { output ->
      val buffer = ByteArray(COPY_BYTES)
      while (true) {
        synchronized(job) { if (job.canceled) throw TransferFailure() }
        val count = input.read(buffer)
        if (count == -1) break
        if (count <= 0 || size + count > upload.byteLength) throw TransferFailure()
        output.write(buffer, 0, count); hash.update(buffer, 0, count)
        size += count; job.uploadCopy = maxOf(job.uploadCopy, count)
      }
    } }
    val digest = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    if (size != upload.byteLength || job.payload.length() != size || digest != upload.contentHash) throw TransferFailure()
  }
  private fun validate(input: TransferRequest) {
    val url = URI(input.url); val origin = URI(input.origin)
    val canonical = input.url.toHttpUrlOrNull()
    if (canonical == null || canonical.toString() != input.url || url.path.contains('\\') || url.path.split('/').any { it == "." || it == ".." }) throw TransferFailure()
    if (expectedOrigin != null && input.origin != expectedOrigin) throw TransferFailure()
    if (url.rawUserInfo != null || url.fragment != null || !url.path.startsWith("/api/") || url.host == null ||
      origin.rawUserInfo != null || origin.fragment != null || origin.query != null || origin.path !in listOf("", "/") ||
      url.scheme != origin.scheme || url.host.lowercase() != origin.host?.lowercase() || effectivePort(url) != effectivePort(origin) || !allowedOrigin(url, expectedOrigin) ||
      input.method !in setOf("GET", "POST", "PUT") || input.maximum !in 1..9007199254740991L ||
      (input.body?.toByteArray(Charsets.UTF_8)?.size ?: 0) > 65536 || (input.method == "GET" && input.body != null)) throw TransferFailure()
    val lower = input.headers.mapKeys { it.key.lowercase() }
    if (lower.size != input.headers.size || lower["origin"] != input.origin || lower.keys.any { it !in requestHeaders } ||
      lower.any { (key, value) -> key.length > 64 || value.length > 32768 || value.any { it == '\r' || it == '\n' || it == '\u0000' } }) throw TransferFailure()
    if (input.method == "PUT") {
      val upload = input.upload ?: throw TransferFailure()
      if (input.body != null || input.maximum != ERROR_BYTES.toLong() || url.query != null ||
        !url.path.matches(Regex("/api/v2/me/lawyer/assets/[A-Za-z0-9_-]{1,128}/content")) ||
        !canonicalUuid(upload.sourceName) || upload.byteLength !in 1..100000000L || !upload.contentHash.matches(Regex("[a-f0-9]{64}")) ||
        lower["content-type"] != "application/octet-stream" || lower["if-match"]?.matches(Regex("[1-9][0-9]*")) != true) throw TransferFailure()
    } else if (input.upload != null) throw TransferFailure()
  }
}
private fun effectivePort(url: URI) = if (url.port >= 0) url.port else if (url.scheme == "https") 443 else 80
private fun allowedOrigin(url: URI, expectedOrigin: String?): Boolean {
  val host = url.host.lowercase().removePrefix("[").removeSuffix("]")
  if (expectedOrigin != null) return url.scheme == "https" && effectivePort(url) == 443 && host in setOf("baro.site", "preview.baro.site")
  if (url.scheme !in setOf("http", "https")) return false
  if (host in setOf("localhost", "::1", "127.0.0.1")) return true
  val parts = host.split('.').map { it.toIntOrNull() ?: return false }
  return parts.size == 4 && parts.all { it in 0..255 } && (parts[0] == 10 || parts[0] == 192 && parts[1] == 168 || parts[0] == 172 && parts[1] in 16..31)
}

private fun ownedName(name: String): Boolean {
  val suffix = if (name.endsWith(".bin")) ".bin" else if (name.endsWith(".upload")) ".upload" else return false
  return canonicalUuid(name.removeSuffix(suffix))
}
private fun canonicalUuid(id: String) = try { UUID.fromString(id).toString() == id } catch (_: Exception) { false }
