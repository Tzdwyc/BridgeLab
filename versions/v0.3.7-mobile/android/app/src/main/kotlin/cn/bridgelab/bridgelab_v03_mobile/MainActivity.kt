package cn.bridgelab.bridgelab_v03_mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingResult: MethodChannel.Result? = null
    private var pendingText: String? = null
    private val createDocument = 3601
    private val openDocument = 3602
    private val maxFileBytes = 16 * 1024 * 1024

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "cn.bridgelab.v03mobile/files")
            .setMethodCallHandler { call, result ->
                if (call.method != "saveFile" && call.method != "openFile") {
                    result.notImplemented()
                } else if (pendingResult != null) {
                    result.error("busy", "A document picker is already open.", null)
                } else {
                    try {
                        val saving = call.method == "saveFile"
                        val text = if (saving) call.argument<String>("text") else null
                        if (saving && (text == null || text.toByteArray(Charsets.UTF_8).size > maxFileBytes)) {
                            throw IllegalArgumentException("File is missing or larger than 16 MiB.")
                        }
                        val intent = Intent(if (saving) Intent.ACTION_CREATE_DOCUMENT else Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType(if (saving) "application/json" else "*/*")
                        if (saving) {
                            val name = call.argument<String>("name") ?: "BridgeLab-history.json"
                            intent.putExtra(Intent.EXTRA_TITLE, name.replace(Regex("[\\\\/]"), "_").take(200))
                        } else {
                            intent.putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
                        }
                        pendingResult = result
                        pendingText = text
                        startActivityForResult(intent, if (saving) createDocument else openDocument)
                    } catch (error: Exception) {
                        pendingResult = null
                        pendingText = null
                        result.error("document_picker", error.message, null)
                    }
                }
            }
    }

    @Deprecated("Android activity result compatibility callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != createDocument && requestCode != openDocument) return
        val result = pendingResult ?: return
        val text = pendingText
        pendingResult = null
        pendingText = null
        val uri: Uri? = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            result.success(if (requestCode == createDocument) false else null)
            return
        }
        try {
            if (requestCode == createDocument) {
                val stream = contentResolver.openOutputStream(uri, "wt")
                    ?: throw IllegalStateException("Selected document cannot be written.")
                stream.use { it.write((text ?: "").toByteArray(Charsets.UTF_8)) }
                result.success(true)
            } else {
                val stream = contentResolver.openInputStream(uri)
                    ?: throw IllegalStateException("Selected document cannot be read.")
                val bytes = stream.use { input ->
                    val buffer = java.io.ByteArrayOutputStream()
                    val chunk = ByteArray(8192)
                    var read = input.read(chunk)
                    while (read != -1) {
                        if (buffer.size() + read > maxFileBytes) throw IllegalArgumentException("File is larger than 16 MiB.")
                        buffer.write(chunk, 0, read)
                        read = input.read(chunk)
                    }
                    buffer.toByteArray()
                }
                var name = "BridgeLab-history.json"
                contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
                }
                result.success(mapOf("name" to name, "text" to bytes.toString(Charsets.UTF_8)))
            }
        } catch (error: Exception) {
            result.error("document_io", error.message, null)
        }
    }
}
