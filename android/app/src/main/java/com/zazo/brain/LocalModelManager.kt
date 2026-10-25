package com.zazo.brain

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import java.io.InputStream
import java.util.zip.ZipInputStream
import java.io.File

/**
 * Runs Gemma 2B with the trained LoRA FlatBuffer.
 * The Colab notebook creates zazo_android_model.zip containing base.bin and lora.bin.
 */
class LocalModelManager(private val context: Context) {
    private val modelDirectory = File(context.filesDir, "models")
    private val baseModelFile = File(modelDirectory, BASE_MODEL_NAME)
    private val loraModelFile = File(modelDirectory, LORA_MODEL_NAME)
    private var inference: LlmInference? = null

    @Synchronized
    fun isAvailable(): Boolean =
        baseModelFile.isFile && baseModelFile.length() > MIN_MODEL_BYTES &&
            loraModelFile.isFile && loraModelFile.length() > MIN_MODEL_BYTES

    @Synchronized
    fun close() {
        inference?.close()
        inference = null
    }

    /** Installs a zazo_android_model.zip safely into the app-private model directory. */
    fun installModel(source: InputStream) {
        modelDirectory.mkdirs()
        val temporaryDirectory = File(modelDirectory, ".staging-${System.currentTimeMillis()}").apply { mkdirs() }
        try {
            ZipInputStream(source.buffered()).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory && (entry.name == BASE_MODEL_NAME || entry.name == LORA_MODEL_NAME)) {
                        val target = File(temporaryDirectory, entry.name)
                        target.outputStream().use { output -> zip.copyTo(output) }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
            val stagedBase = File(temporaryDirectory, BASE_MODEL_NAME)
            val stagedLora = File(temporaryDirectory, LORA_MODEL_NAME)
            require(stagedBase.length() > MIN_MODEL_BYTES && stagedLora.length() > MIN_MODEL_BYTES) {
                "حزمة Android يجب أن تحتوي base.bin وlora.bin صالحين"
            }
            close()
            baseModelFile.delete()
            loraModelFile.delete()
            check(stagedBase.renameTo(baseModelFile)) { "تعذر تثبيت base.bin" }
            check(stagedLora.renameTo(loraModelFile)) { "تعذر تثبيت lora.bin" }
        } finally {
            temporaryDirectory.deleteRecursively()
        }
    }

    @Synchronized
    fun generate(prompt: String): String {
        check(isAvailable()) { "لم يتم تثبيت حزمة نموذج Zazo المحلية بعد" }
        val activeInference = inference ?: LlmInference.createFromOptions(
            context,
            LlmInference.LlmInferenceOptions.builder()
                .setModelPath(baseModelFile.absolutePath)
                .setMaxTokens(MAX_TOKENS)
                .build(),
        ).also { inference = it }
        val session = LlmInferenceSession.createFromOptions(
            activeInference,
            LlmInferenceSession.LlmInferenceSessionOptions.builder()
                .setLoraPath(loraModelFile.absolutePath)
                .setTopK(TOP_K)
                .setTemperature(TEMPERATURE)
                .build(),
        )
        return try {
            session.addQueryChunk(prompt)
            session.generateResponse().trim()
        } finally {
            session.close()
        }
    }

    companion object {
        const val BASE_MODEL_NAME = "base.bin"
        const val LORA_MODEL_NAME = "lora.bin"
        private const val MIN_MODEL_BYTES = 1024L * 1024L
        private const val MAX_TOKENS = 512
        private const val TOP_K = 40
        private const val TEMPERATURE = 0.7f
    }
}
