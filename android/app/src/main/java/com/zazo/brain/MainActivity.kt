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
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
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
    private val remoteUiUrl = BuildConfig.WEB_UI_URL.takeIf { it.isNotBlank() }
    private var remoteHomeLoadInProgress = false
    private var localFallbackLoaded = false
    private var updateCheckStarted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
            settings.allowContentAccess = false
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.setSupportMultipleWindows(false)
            settings.textZoom = 100
            webChromeClient = WebChromeClient()
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
        super.onDestroy()
    }

    companion object {
        private const val LOCAL_ASSET_HOST = "appassets.androidplatform.net"
        private const val LOCAL_UI_URL = "https://appassets.androidplatform.net/assets/index.html"
        private const val GITHUB_REPOSITORY = "zazotona301-oss/zazo"
        private const val RELEASES_URL = "https://github.com/zazotona301-oss/zazo/releases"
        private const val PREFERENCES = "zazo_update_state"
        private const val PENDING_INSTALL = "pending_install_path"
    }
}
