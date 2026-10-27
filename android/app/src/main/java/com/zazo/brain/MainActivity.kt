package com.zazo.brain

import android.app.AlertDialog
import android.app.ProgressDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.provider.OpenableColumns
import android.text.InputType
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.webkit.JavascriptInterface
import android.widget.Toast
import android.widget.EditText
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.IntentSenderRequest
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var localModelManager: LocalModelManager
    private val remoteUiUrl = BuildConfig.WEB_UI_URL.takeIf { it.isNotBlank() }
    private var remoteHomeLoadInProgress = false
    private var localFallbackLoaded = false
    private var updateCheckStarted = false
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    @Volatile
    private var pendingDriveUpload: PendingDriveUpload? = null

    private data class PendingDriveUpload(
        val fileName: String,
        val mimeType: String,
        val bytes: ByteArray,
        val callbackName: String,
    )

    private val driveAuthorizationLauncher: ActivityResultLauncher<IntentSenderRequest> =
        registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            try {
                val authorizationResult = Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(result.data)
                finishDriveAuthorization(authorizationResult)
            } catch (error: ApiException) {
                finishDriveWithError("فشل تفويض Google Drive: ${error.statusCode}")
            } catch (error: Exception) {
                finishDriveWithError(error.message ?: "فشل تفويض Google Drive")
            }
        }

    private val localModelPickerLauncher: ActivityResultLauncher<Intent> = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (data == null) {
            publishModelTransfer("phone", "cancelled", "لم يتم اختيار ملف")
            return@registerForActivityResult
        }
        val selectedUris = buildList {
            data.data?.let(::add)
            data.clipData?.let { clip ->
                for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri)
            }
        }.distinct()
        if (selectedUris.isEmpty()) {
            publishModelTransfer("phone", "cancelled", "لم يتم اختيار ملف")
            return@registerForActivityResult
        }
        val selectedNames = selectedUris.map(::displayName)
        publishModelTransfer("phone", "installing", "جارٍ قراءة الملف أو فك ضغط الحزمة وتثبيت النموذج…", selectedNames.joinToString(", "))
        executor.execute {
            try {
                if (selectedUris.size == 1 && selectedNames.first().endsWith(".zip", ignoreCase = true)) {
                    contentResolver.openInputStream(selectedUris.first())?.use { localModelManager.installModel(it) }
                        ?: error("تعذر فتح ملف ZIP")
                } else if (selectedUris.size == 1 && selectedNames.first().endsWith(".task", ignoreCase = true)) {
                    contentResolver.openInputStream(selectedUris.first())?.use {
                        localModelManager.installTaskModel(it, "local-import", selectedNames.first())
                    } ?: error("تعذر فتح ملف MediaPipe")
                } else {
                    val files = selectedUris.map { uri ->
                        val input = contentResolver.openInputStream(uri) ?: error("تعذر فتح ملف النموذج")
                        displayName(uri) to input
                    }
                    localModelManager.installFiles(files)
                }
                mainHandler.post {
                    publishModelTransfer("phone", "completed", "تم تثبيت النموذج وتفعيله من ملفات الهاتف", selectedNames.joinToString(", "))
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('zazo-local-model-ready'))", null)
                }
            } catch (error: Exception) {
                mainHandler.post {
                    publishModelTransfer("phone", "error", "تعذر تثبيت النموذج: ${error.message ?: "خطأ غير معروف"}", selectedNames.joinToString(", "))
                }
            }
        }
    }

    private fun displayName(uri: Uri): String =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) ?: uri.lastPathSegment.orEmpty()
            else uri.lastPathSegment.orEmpty()
        } ?: uri.lastPathSegment.orEmpty()

    private fun publishModelTransfer(
        source: String,
        stage: String,
        message: String,
        fileName: String? = null,
        transferredBytes: Long? = null,
        totalBytes: Long? = null,
    ) {
        val details = JSONObject()
            .put("source", source)
            .put("stage", stage)
            .put("message", message)
        fileName?.let { details.put("fileName", it) }
        transferredBytes?.let { details.put("transferredBytes", it) }
        totalBytes?.takeIf { it > 0L }?.let {
            details.put("totalBytes", it)
            transferredBytes?.let { amount -> details.put("percent", ((amount * 100L) / it).toInt().coerceIn(0, 100)) }
        }
        val js = "window.dispatchEvent(new CustomEvent('zazo-model-transfer',{detail:JSON.parse(${JSONObject.quote(details.toString())})}))"
        mainHandler.post {
            if (::webView.isInitialized) webView.evaluateJavascript(js, null)
        }
    }

    private val filePickerLauncher: ActivityResultLauncher<Intent> = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback
        filePathCallback = null
        val uri = result.data?.data
        callback?.onReceiveValue(uri?.let { arrayOf(it) })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        localModelManager = LocalModelManager(this)
        window.statusBarColor = android.graphics.Color.rgb(10, 14, 26)
        window.navigationBarColor = android.graphics.Color.rgb(10, 14, 26)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadsImagesAutomatically = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.setSupportMultipleWindows(false)
            settings.textZoom = 100
            addJavascriptInterface(LocalModelBridge(), "AndroidZazoLocal")
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    params: WebChromeClient.FileChooserParams?,
                ): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    val intent = try {
                        params?.createIntent() ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    } catch (_: Exception) {
                        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    }
                    return try {
                        filePickerLauncher.launch(intent)
                        true
                    } catch (_: Exception) {
                        filePathCallback?.onReceiveValue(null)
                        filePathCallback = null
                        false
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest,
                ) = if (isLocalAssetUri(request.url)) {
                    assetLoader.shouldInterceptRequest(request.url)
                } else {
                    null
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest,
                ): Boolean {
                    val uri = request.url
                    if (isLocalAssetUri(uri) || isConfiguredRemoteUri(uri)) return false
                    if (uri.scheme.equals("https", ignoreCase = true) ||
                        uri.scheme.equals("http", ignoreCase = true)
                    ) {
                        return try {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                            true
                        } catch (_: Exception) {
                            true
                        }
                    }
                    return true
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (url != null && isConfiguredRemoteUri(Uri.parse(url))) {
                        remoteHomeLoadInProgress = false
                    }
                    if (!updateCheckStarted) {
                        updateCheckStarted = true
                        checkForUpdate()
                    }
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?,
                ) {
                    super.onReceivedError(view, request, error)
                    if (request?.isForMainFrame == true) fallbackToLocalAssets(view)
                }

                override fun onReceivedHttpError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    errorResponse: WebResourceResponse?,
                ) {
                    super.onReceivedHttpError(view, request, errorResponse)
                    if (request?.isForMainFrame == true &&
                        (errorResponse?.statusCode ?: 0) >= 400
                    ) {
                        fallbackToLocalAssets(view)
                    }
                }
            }
        }
        setContentView(webView)
        remoteHomeLoadInProgress = remoteUiUrl != null
        webView.loadUrl(remoteUiUrl ?: LOCAL_UI_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
                else finish()
            }
        })
    }

    override fun onResume() {
        super.onResume()
        resumePendingInstallIfAllowed()
    }

    private fun fallbackToLocalAssets(view: WebView?) {
        if (!remoteHomeLoadInProgress || localFallbackLoaded) return
        remoteHomeLoadInProgress = false
        localFallbackLoaded = true
        (view ?: webView).loadUrl(LOCAL_UI_URL)
    }

    private fun isLocalAssetUri(uri: Uri): Boolean =
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(LOCAL_ASSET_HOST, ignoreCase = true) &&
            uri.path?.startsWith("/assets/") == true

    private fun isConfiguredRemoteUri(uri: Uri): Boolean {
        val configured = remoteUiUrl?.let(Uri::parse) ?: return false
        return uri.scheme.equals(configured.scheme, ignoreCase = true) &&
            uri.host.equals(configured.host, ignoreCase = true) &&
            effectivePort(uri) == effectivePort(configured)
    }

    private fun effectivePort(uri: Uri): Int = when {
        uri.port != -1 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        uri.scheme.equals("http", ignoreCase = true) -> 80
        else -> -1
    }

    private fun checkForUpdate() {
        executor.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("https://api.github.com/repos/$GITHUB_REPOSITORY/releases/latest")
                    .openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12_000
                    readTimeout = 12_000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
                    setRequestProperty("User-Agent", "Zazo-Android-Updater")
                }
                val status = connection.responseCode
                if (status == HttpURLConnection.HTTP_NOT_FOUND) {
                    mainHandler.post {
                        Toast.makeText(
                            this,
                            "لا توجد إصدارات عامة يمكن الوصول إليها على GitHub؛ قد يكون المستودع خاصاً.",
                            Toast.LENGTH_LONG,
                        ).show()
                    }
                    return@execute
                }
                if (status !in 200..299) return@execute

                val release = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                val tag = release.optString("tag_name", "").removePrefix("v")
                if (tag.isBlank() || compareVersions(tag, BuildConfig.VERSION_NAME) <= 0) return@execute

                val assets = release.optJSONArray("assets") ?: return@execute
                var apkUrl: String? = null
                var apkDigest: String? = null
                for (index in 0 until assets.length()) {
                    val asset = assets.optJSONObject(index) ?: continue
                    val name = asset.optString("name")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        apkUrl = asset.optString("browser_download_url").takeIf { it.startsWith("https://") }
                        apkDigest = asset.optString("digest").takeIf { it.startsWith("sha256:") }
                        break
                    }
                }
                val downloadUrl = apkUrl ?: return@execute
                val digest = apkDigest
                mainHandler.post { showUpdateDialog(tag, downloadUrl, digest) }
            } catch (_: Exception) {
                // An update check is optional; keep the app usable when offline.
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun showUpdateDialog(tag: String, downloadUrl: String, digest: String?) {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle("تحديث جديد لـ Zazo Brain")
            .setMessage("الإصدار $tag متاح على GitHub. هل تريد تنزيل APK وتثبيته؟")
            .setPositiveButton("تنزيل وتثبيت") { _, _ -> downloadUpdate(tag, downloadUrl, digest) }
            .setNeutralButton("عرض الإصدار على GitHub") { _, _ ->
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_URL)))
            }
            .setNegativeButton("لاحقًا", null)
            .show()
    }

    private fun downloadUpdate(tag: String, downloadUrl: String, expectedDigest: String?) {
        val progress = ProgressDialog(this).apply {
            setTitle("تنزيل التحديث")
            setMessage("جارٍ تنزيل الإصدار $tag من GitHub…")
            setProgressStyle(ProgressDialog.STYLE_SPINNER)
            setCancelable(false)
            show()
        }
        executor.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20_000
                    readTimeout = 30_000
                    instanceFollowRedirects = true
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "Zazo-Android-Updater")
                }
                if (connection.responseCode !in 200..299) {
                    throw IllegalStateException("GitHub download returned HTTP ${connection.responseCode}")
                }

                val updateDirectory = File(cacheDir, "updates").apply { mkdirs() }
                val apkFile = File(updateDirectory, "zazo-$tag.apk")
                connection.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output -> input.copyTo(output) }
                }
                if (apkFile.length() < 1_000_000) {
                    apkFile.delete()
                    throw IllegalStateException("Downloaded APK is unexpectedly small")
                }
                if (expectedDigest != null) {
                    val expectedHex = expectedDigest.removePrefix("sha256:").lowercase()
                    val actualHex = sha256(apkFile)
                    if (!actualHex.equals(expectedHex, ignoreCase = true)) {
                        apkFile.delete()
                        throw SecurityException("Downloaded APK checksum does not match GitHub's digest")
                    }
                }
                mainHandler.post {
                    progress.dismiss()
                    installApk(apkFile)
                }
            } catch (_: Exception) {
                mainHandler.post {
                    progress.dismiss()
                    Toast.makeText(
                        this,
                        "تعذر تنزيل التحديث من GitHub. تحقق من إتاحة ملف APK لهذا الإصدار.",
                        Toast.LENGTH_LONG,
                    ).show()
                }
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var count = input.read(buffer)
            while (count >= 0) {
                if (count > 0) digest.update(buffer, 0, count)
                count = input.read(buffer)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun installApk(apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .edit()
                .putString(PENDING_INSTALL, apkFile.absolutePath)
                .apply()
            AlertDialog.Builder(this)
                .setTitle("السماح بتثبيت التحديث")
                .setMessage("اسمح لـ Zazo Brain بتثبيت التطبيقات من هذا المصدر، ثم ارجع إلى التطبيق.")
                .setPositiveButton("فتح الإعدادات") { _, _ ->
                    val intent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName"),
                    )
                    startActivity(intent)
                }
                .setNegativeButton("إلغاء", null)
                .show()
            return
        }
        launchInstaller(apkFile)
    }

    private fun resumePendingInstallIfAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !packageManager.canRequestPackageInstalls()) return
        val preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
        val path = preferences.getString(PENDING_INSTALL, null) ?: return
        preferences.edit().remove(PENDING_INSTALL).apply()
        val file = File(path)
        if (file.exists()) launchInstaller(file)
    }

    private fun launchInstaller(apkFile: File) {
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, "تعذر فتح مثبت Android لهذا الملف.", Toast.LENGTH_LONG).show()
        }
    }

    private fun requestDriveAuthorization() {
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(DRIVE_SCOPE)))
            .build()
        Identity.getAuthorizationClient(this)
            .authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    driveAuthorizationLauncher.launch(
                        IntentSenderRequest.Builder(result.pendingIntent!!.intentSender).build(),
                    )
                } else {
                    finishDriveAuthorization(result)
                }
            }
            .addOnFailureListener { error ->
                finishDriveWithError(error.message ?: "فشل طلب صلاحية Google Drive")
            }
    }

    private fun finishDriveAuthorization(result: AuthorizationResult) {
        val token = result.accessToken
        if (token.isNullOrBlank()) {
            finishDriveWithError("لم تُرجع Google رمز وصول إلى Drive")
            return
        }
        val upload = pendingDriveUpload ?: return
        executor.execute { uploadToDrive(upload, token) }
    }

    private fun uploadToDrive(upload: PendingDriveUpload, accessToken: String) {
        var connection: HttpURLConnection? = null
        try {
            val boundary = "zazo-drive-${System.currentTimeMillis()}"
            val metadata = JSONObject()
                .put("name", upload.fileName)
                .put("parents", org.json.JSONArray().put(GOOGLE_DRIVE_FOLDER_ID))
                .put("description", "Uploaded from Zazo Android")
            connection = (URL(DRIVE_UPLOAD_URL).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                readTimeout = 60_000
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Authorization", "Bearer $accessToken")
                setRequestProperty("Content-Type", "multipart/related; boundary=$boundary")
            }
            connection.outputStream.use { output ->
                output.write("--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".toByteArray())
                output.write(metadata.toString().toByteArray())
                output.write("\r\n--$boundary\r\nContent-Type: ${upload.mimeType}\r\n\r\n".toByteArray())
                output.write(upload.bytes)
                output.write("\r\n--$boundary--\r\n".toByteArray())
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            if (status !in 200..299) throw IllegalStateException("Google Drive HTTP $status: $body")
            finishDriveWithPayload(JSONObject().put("ok", true).put("file", JSONObject(body)).toString(), upload.callbackName)
        } catch (error: Exception) {
            finishDriveWithPayload(
                JSONObject().put("ok", false).put("error", error.message ?: "فشل رفع الملف إلى Google Drive").toString(),
                upload.callbackName,
            )
        } finally {
            connection?.disconnect()
        }
    }

    private fun finishDriveAuthorizationError(message: String) {
        val upload = pendingDriveUpload ?: return
        finishDriveWithPayload(JSONObject().put("ok", false).put("error", message).toString(), upload.callbackName)
    }

    private fun finishDriveWithError(message: String) = finishDriveAuthorizationError(message)

    private fun finishDriveWithPayload(payload: String, callbackName: String) {
        pendingDriveUpload = null
        mainHandler.post {
            if (::webView.isInitialized) webView.evaluateJavascript("$callbackName(${JSONObject.quote(payload)})", null)
        }
    }

    private fun compareVersions(left: String, right: String): Int {
        val numberPattern = Regex("\\d+")
        val leftParts = numberPattern.findAll(left).map { it.value.toLongOrNull() ?: 0L }.toList()
        val rightParts = numberPattern.findAll(right).map { it.value.toLongOrNull() ?: 0L }.toList()
        val length = maxOf(leftParts.size, rightParts.size)
        for (index in 0 until length) {
            val a = leftParts.getOrElse(index) { 0L }
            val b = rightParts.getOrElse(index) { 0L }
            if (a != b) return a.compareTo(b)
        }
        return 0
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        executor.shutdownNow()
        if (::localModelManager.isInitialized) localModelManager.close()
        super.onDestroy()
    }

    private fun promptForHuggingFaceModel(callbackName: String) {
        val repositoryInput = EditText(this).apply {
            hint = "مثال: owner/model-repository"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("تنزيل نموذج MediaPipe من Hugging Face")
            .setMessage("أدخل معرّف مستودع عام. سيعرض التطبيق ملفات .task الجاهزة فقط.")
            .setView(repositoryInput)
            .setNegativeButton("إلغاء") { _, _ -> completeHuggingFaceCallback(callbackName, false, "تم إلغاء اختيار النموذج") }
            .setPositiveButton("بحث عن النماذج", null)
            .create().also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val repositoryId = repositoryInput.text.toString().trim()
                        if (!repositoryId.matches(Regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"))) {
                            repositoryInput.error = "اكتب owner/repository"
                            return@setOnClickListener
                        }
                        dialog.dismiss()
                        findHuggingFaceTaskModels(repositoryId, callbackName)
                    }
                }
                dialog.show()
            }
    }

    private fun findHuggingFaceTaskModels(repositoryId: String, callbackName: String) {
        publishModelTransfer("huggingface", "searching", "جارٍ فحص المستودع والبحث عن ملفات MediaPipe .task…", repositoryId)
        executor.execute {
            try {
                val encodedId = repositoryId.split('/').joinToString("/") { Uri.encode(it) }
                val connection = (URL("https://huggingface.co/api/models/$encodedId").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20_000
                    readTimeout = 30_000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", "Zazo-Android-Model-Installer")
                }
                val status = connection.responseCode
                if (status !in 200..299) error("تعذر قراءة المستودع (HTTP $status). تأكد أن المستودع عام ومعرّفه صحيح.")
                val response = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()
                val siblings = JSONObject(response).optJSONArray("siblings") ?: error("استجابة Hugging Face غير صالحة")
                val taskFiles = (0 until siblings.length()).mapNotNull { index ->
                    siblings.optJSONObject(index)?.optString("rfilename")
                        ?.takeIf { it.endsWith(".task", ignoreCase = true) }
                }
                mainHandler.post {
                    if (taskFiles.isEmpty()) {
                        publishModelTransfer("huggingface", "error", "لم أجد ملف .task جاهزاً في $repositoryId. هذا التطبيق لا يشغّل safetensors أو GGUF الخام.")
                        completeHuggingFaceCallback(callbackName, false, "لم أجد ملف .task جاهزاً في $repositoryId. هذا التطبيق لا يشغّل safetensors أو GGUF الخام.")
                        return@post
                    }
                    publishModelTransfer("huggingface", "choosing", "وُجد ${taskFiles.size} ملفاً متوافقاً. اختر الملف لبدء التنزيل.", repositoryId)
                    AlertDialog.Builder(this)
                        .setTitle("اختر ملف MediaPipe من $repositoryId")
                        .setItems(taskFiles.toTypedArray()) { _, selected ->
                            downloadHuggingFaceTask(repositoryId, taskFiles[selected], callbackName)
                        }
                        .setNegativeButton("إلغاء") { _, _ ->
                            publishModelTransfer("huggingface", "cancelled", "أُلغِي اختيار ملف النموذج.", repositoryId)
                            completeHuggingFaceCallback(callbackName, false, "تم إلغاء التنزيل")
                        }
                        .show()
                }
            } catch (error: Exception) {
                mainHandler.post {
                    publishModelTransfer("huggingface", "error", error.message ?: "تعذر فحص مستودع Hugging Face", repositoryId)
                    completeHuggingFaceCallback(callbackName, false, error.message ?: "تعذر فحص مستودع Hugging Face")
                }
            }
        }
    }

    private fun downloadHuggingFaceTask(repositoryId: String, fileName: String, callbackName: String) {
        publishModelTransfer("huggingface", "downloading", "بدأ التنزيل من Hugging Face…", fileName)
        executor.execute {
            var connection: HttpURLConnection? = null
            try {
                val encodedId = repositoryId.split('/').joinToString("/") { Uri.encode(it) }
                val encodedFile = fileName.split('/').joinToString("/") { Uri.encode(it) }
                connection = (URL("https://huggingface.co/$encodedId/resolve/main/$encodedFile?download=true").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 30_000
                    readTimeout = 120_000
                    instanceFollowRedirects = true
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "Zazo-Android-Model-Installer")
                }
                val status = connection.responseCode
                if (status !in 200..299) error("تعذر تنزيل النموذج (HTTP $status)")
                val totalBytes = connection.contentLengthLong.takeIf { it > 0L }
                connection.inputStream.use { input ->
                    localModelManager.installTaskModel(input, repositoryId, fileName, totalBytes) { transferred, total ->
                        publishModelTransfer("huggingface", "downloading", "تنزيل ملف النموذج…", fileName, transferred, total)
                    }
                }
                mainHandler.post {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('zazo-local-model-ready'))", null)
                    publishModelTransfer("huggingface", "completed", "اكتمل التنزيل وتم تفعيل النموذج المحلي.", fileName, totalBytes, totalBytes)
                    completeHuggingFaceCallback(callbackName, true, "تم تنزيل النموذج وتفعيله: $repositoryId/$fileName")
                }
            } catch (error: Exception) {
                mainHandler.post {
                    publishModelTransfer("huggingface", "error", error.message ?: "فشل تنزيل النموذج", fileName)
                    completeHuggingFaceCallback(callbackName, false, error.message ?: "فشل تنزيل النموذج")
                }
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun completeHuggingFaceCallback(callbackName: String, ok: Boolean, message: String) {
        if (!callbackName.matches(Regex("^[A-Za-z_$][A-Za-z0-9_$]*$"))) return
        val payload = JSONObject().put("ok", ok).put("message", message).toString()
        webView.evaluateJavascript("$callbackName(${JSONObject.quote(payload)})", null)
    }

    private inner class LocalModelBridge {
        @JavascriptInterface
        fun isAvailable(): Boolean = localModelManager.isAvailable()

        @JavascriptInterface
        fun chooseModel() {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                // Show all files. Many file managers report .bin/.zip as unknown MIME;
                // the installer validates the selected contents after the picker.
                type = "*/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            mainHandler.post {
                try {
                    localModelPickerLauncher.launch(intent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "تعذر فتح اختيار ملف النموذج", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun chooseHuggingFaceModel(callbackName: String) {
            if (!callbackName.matches(Regex("^[A-Za-z_$][A-Za-z0-9_$]*$"))) return
            mainHandler.post { promptForHuggingFaceModel(callbackName) }
        }

        @JavascriptInterface
        fun ask(prompt: String, callbackName: String) {
            if (!callbackName.matches(Regex("^[A-Za-z_$][A-Za-z0-9_$]*$"))) return
            executor.execute {
                val payload = try {
                    JSONObject().put("ok", true).put("text", localModelManager.generate(prompt)).toString()
                } catch (error: Exception) {
                    JSONObject().put("ok", false).put("error", error.message ?: "تعذر تشغيل النموذج المحلي").toString()
                }
                mainHandler.post {
                    webView.evaluateJavascript("$callbackName(${JSONObject.quote(payload)})", null)
                }
            }
        }

        @JavascriptInterface
        fun uploadTrainingFile(fileName: String, mimeType: String, base64: String, callbackName: String) {
            if (!callbackName.matches(Regex("^[A-Za-z_$][A-Za-z0-9_$]*$"))) return
            executor.execute {
                try {
                    pendingDriveUpload = PendingDriveUpload(
                        fileName = fileName,
                        mimeType = mimeType.ifBlank { "application/octet-stream" },
                        bytes = Base64.decode(base64, Base64.DEFAULT),
                        callbackName = callbackName,
                    )
                    mainHandler.post { requestDriveAuthorization() }
                } catch (error: Exception) {
                    mainHandler.post {
                        webView.evaluateJavascript(
                            "$callbackName(${JSONObject.quote(JSONObject().put("ok", false).put("error", error.message ?: "ملف غير صالح").toString())})",
                            null,
                        )
                    }
                }
            }
        }
    }

    companion object {
        private const val DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
        private const val GOOGLE_DRIVE_FOLDER_ID = "1IzEUSNFHeu_YqV71n3l8yxyM_g6GTpmV"
        private const val DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size"
        private const val LOCAL_ASSET_HOST = "appassets.androidplatform.net"
        private const val LOCAL_UI_URL = "https://appassets.androidplatform.net/assets/index.html"
        private const val GITHUB_REPOSITORY = "zazotona301-oss/zazo"
        private const val RELEASES_URL = "https://github.com/zazotona301-oss/zazo/releases"
        private const val PREFERENCES = "zazo_update_state"
        private const val PENDING_INSTALL = "pending_install_path"
    }
}
