package com.zazo.brain

import android.content.Context
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.runBlocking
import java.io.File

/**
 * Owns the on-device LiteRT-LM engine.
 *
 * The model is intentionally kept outside the APK at filesDir/models/zazo.litertlm
 * so an APK update does not duplicate a multi-gigabyte model. The app can install
 * the file through the Android file picker exposed by MainActivity.
 */
class LocalModelManager(private val context: Context) {
    private val modelDirectory = File(context.filesDir, "models")
    private val modelFile = File(modelDirectory, MODEL_FILE_NAME)
    private var engine: Engine? = null

    @Synchronized
    fun isAvailable(): Boolean = modelFile.isFile && modelFile.length() > MIN_MODEL_BYTES

    @Synchronized
    fun modelPath(): String = modelFile.absolutePath

    @Synchronized
    fun close() {
        engine?.close()
        engine = null
    }

    fun installModel(source: java.io.InputStream) {
        modelDirectory.mkdirs()
        val temporary = File(modelDirectory, "$MODEL_FILE_NAME.part")
        source.use { input ->
            temporary.outputStream().use { output -> input.copyTo(output) }
        }
        require(temporary.length() > MIN_MODEL_BYTES) { "ملف LiteRT-LM صغير أو غير مكتمل" }
        if (!temporary.renameTo(modelFile)) {
            modelFile.delete()
            check(temporary.renameTo(modelFile)) { "تعذر تثبيت ملف النموذج" }
        }
        close()
    }

    /** Runs one prompt off the UI thread. The caller already serializes requests. */
    @Synchronized
    fun generate(prompt: String): String {
        check(isAvailable()) { "لم يتم تثبيت نموذج Zazo المحلي بعد" }
        val activeEngine = engine ?: Engine(EngineConfig(modelPath = modelFile.absolutePath)).also {
            it.initialize()
            engine = it
        }
        val conversation = activeEngine.createConversation()
        return try {
            val result = StringBuilder()
            runBlocking {
                conversation.sendMessageAsync(prompt).collect { message -> result.append(message.toString()) }
            }
            result.toString().trim()
        } finally {
            conversation.close()
        }
    }

    companion object {
        const val MODEL_FILE_NAME = "zazo.litertlm"
        private const val MIN_MODEL_BYTES = 1024L * 1024L
    }
}
