package com.zazo.brain

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream

/**
 * Runs Gemma 2B with the Android FlatBuffer base model and LoRA.
 * The installer accepts either a ZIP containing base.bin/lora.bin or the two
 * unpacked files selected together by the user.
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

    /** Installs any ZIP filename containing base.bin and lora.bin. */
    fun installModel(source: InputStream) {
        modelDirectory.mkdirs()
        val temporaryDirectory = createStagingDirectory()
        var sawSafetensors = false
        try {
            ZipInputStream(source.buffered()).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    val entryBaseName = entry.name.substringAfterLast('/').substringAfterLast('\\')
                    if (!entry.isDirectory && entryBaseName.endsWith(".safetensors", ignoreCase = true)) {
                        sawSafetensors = true
                    }
                    if (!entry.isDirectory && entryBaseName in setOf(BASE_MODEL_NAME, LORA_MODEL_NAME)) {
                        File(temporaryDirectory, entryBaseName).outputStream().use { output ->
                            zip.copyTo(output)
                        }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
            commitStaged(temporaryDirectory, sawSafetensors)
        } finally {
            temporaryDirectory.deleteRecursively()
        }
    }

    /** Installs unpacked files selected together, such as base.bin and lora.bin. */
    fun installFiles(files: List<Pair<String, InputStream>>) {
        require(files.isNotEmpty()) { "اختر ملفي base.bin وlora.bin معًا" }
        modelDirectory.mkdirs()
        val temporaryDirectory = createStagingDirectory()
        var sawSafetensors = false
        try {
            files.forEach { (name, source) ->
                val baseName = File(name).name
                if (baseName.endsWith(".safetensors", ignoreCase = true)) {
                    sawSafetensors = true
                }
                if (baseName == BASE_MODEL_NAME || baseName == LORA_MODEL_NAME) {
                    source.use { input ->
                        File(temporaryDirectory, baseName).outputStream().use { output ->
                            input.copyTo(output)
                        }
                    }
                } else {
                    source.close()
                }
            }
            commitStaged(temporaryDirectory, sawSafetensors)
        } finally {
            temporaryDirectory.deleteRecursively()
        }
    }

    private fun createStagingDirectory(): File =
        File(modelDirectory, ".staging-${System.currentTimeMillis()}").apply { mkdirs() }

    private fun commitStaged(temporaryDirectory: File, sawSafetensors: Boolean) {
        val stagedBase = File(temporaryDirectory, BASE_MODEL_NAME)
        val stagedLora = File(temporaryDirectory, LORA_MODEL_NAME)
        require(stagedBase.length() > MIN_MODEL_BYTES && stagedLora.length() > MIN_MODEL_BYTES) {
            if (sawSafetensors) {
                "هذه أوزان Hugging Face بصيغة .safetensors وليست أوزان Android. يجب تحويلها أولًا إلى base.bin وlora.bin"
            } else {
                "اختر ZIP يحتوي base.bin وlora.bin، أو اختر الملفين المفكوكين معًا"
            }
        }
        close()
        baseModelFile.delete()
        loraModelFile.delete()
        check(stagedBase.renameTo(baseModelFile)) { "تعذر تثبيت base.bin" }
        check(stagedLora.renameTo(loraModelFile)) { "تعذر تثبيت lora.bin" }
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
