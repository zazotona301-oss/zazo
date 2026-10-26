package com.zazo.brain

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/** Installs and runs MediaPipe-ready models, with optional LoRA weights. */
class LocalModelManager(private val context: Context) {
    private val modelDirectory = File(context.filesDir, "models")
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val baseModelFile = File(modelDirectory, BASE_MODEL_NAME)
    private val loraModelFile = File(modelDirectory, LORA_MODEL_NAME)
    private var inference: LlmInference? = null

    @Synchronized
    fun isAvailable(): Boolean {
        val configuredName = preferences.getString(ACTIVE_MODEL_KEY, null)
        if (configuredName != null) {
            val configuredFile = File(modelDirectory, configuredName)
            return configuredFile.isFile && configuredFile.length() > MIN_MODEL_BYTES
        }
        // Backward compatibility with installations made by earlier Zazo versions.
        return baseModelFile.isFile && baseModelFile.length() > MIN_MODEL_BYTES &&
            loraModelFile.isFile && loraModelFile.length() > MIN_MODEL_BYTES
    }

    @Synchronized
    fun close() {
        inference?.close()
        inference = null
    }

    /** Installs the existing ZIP format containing base.bin and lora.bin. */
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
                        File(temporaryDirectory, entryBaseName).outputStream().use { output -> zip.copyTo(output) }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
            commitLoraPair(temporaryDirectory, sawSafetensors)
        } finally {
            temporaryDirectory.deleteRecursively()
        }
    }

    /** Installs unpacked base.bin/lora.bin files selected together. */
    fun installFiles(files: List<Pair<String, InputStream>>) {
        require(files.isNotEmpty()) { "اختر ملفي base.bin وlora.bin معًا" }
        modelDirectory.mkdirs()
        val temporaryDirectory = createStagingDirectory()
        var sawSafetensors = false
        try {
            files.forEach { (name, source) ->
                val baseName = File(name).name
                if (baseName.endsWith(".safetensors", ignoreCase = true)) sawSafetensors = true
                if (baseName == BASE_MODEL_NAME || baseName == LORA_MODEL_NAME) {
                    source.use { input -> File(temporaryDirectory, baseName).outputStream().use(input::copyTo) }
                } else {
                    source.close()
                }
            }
            commitLoraPair(temporaryDirectory, sawSafetensors)
        } finally {
            temporaryDirectory.deleteRecursively()
        }
    }

    /** Installs a single MediaPipe .task model without imposing a repository-specific name. */
    @Synchronized
    fun installTaskModel(source: InputStream, repositoryId: String, sourceFileName: String) {
        require(sourceFileName.endsWith(".task", ignoreCase = true)) {
            "يدعم التنزيل المباشر ملفات MediaPipe ذات الامتداد .task فقط؛ حوّل safetensors أو GGUF أولاً"
        }
        modelDirectory.mkdirs()
        val safeName = File(sourceFileName).name.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val identity = sha256("$repositoryId/$sourceFileName").take(12)
        val installedName = "hf-$identity-$safeName"
        val temporaryFile = File(modelDirectory, ".$installedName.part")
        val installedFile = File(modelDirectory, installedName)
        try {
            source.use { input -> temporaryFile.outputStream().buffered().use(input::copyTo) }
            require(temporaryFile.isFile && temporaryFile.length() > MIN_MODEL_BYTES) {
                "ملف النموذج فارغ أو أصغر من الحجم المتوقع"
            }
            close()
            if (installedFile.exists()) installedFile.delete()
            check(temporaryFile.renameTo(installedFile)) { "تعذر حفظ ملف النموذج على الجهاز" }
            preferences.edit()
                .putString(ACTIVE_MODEL_KEY, installedName)
                .remove(ACTIVE_LORA_KEY)
                .putString(ACTIVE_MODEL_LABEL_KEY, "$repositoryId/$sourceFileName")
                .apply()
        } finally {
            temporaryFile.delete()
        }
    }

    private fun commitLoraPair(temporaryDirectory: File, sawSafetensors: Boolean) {
        val stagedBase = File(temporaryDirectory, BASE_MODEL_NAME)
        val stagedLora = File(temporaryDirectory, LORA_MODEL_NAME)
        require(stagedBase.length() > MIN_MODEL_BYTES && stagedLora.length() > MIN_MODEL_BYTES) {
            if (sawSafetensors) {
                "هذه أوزان Hugging Face بصيغة .safetensors وليست أوزان Android. يلزم تحويلها أولاً إلى base.bin وlora.bin"
            } else {
                "اختر ZIP يحتوي base.bin وlora.bin، أو اختر الملفين المفكوكين معًا"
            }
        }
        close()
        check(stagedBase.copyTo(baseModelFile, overwrite = true).length() > MIN_MODEL_BYTES) { "تعذر تثبيت base.bin" }
        check(stagedLora.copyTo(loraModelFile, overwrite = true).length() > MIN_MODEL_BYTES) { "تعذر تثبيت lora.bin" }
        preferences.edit()
            .putString(ACTIVE_MODEL_KEY, BASE_MODEL_NAME)
            .putString(ACTIVE_LORA_KEY, LORA_MODEL_NAME)
            .putString(ACTIVE_MODEL_LABEL_KEY, "Zazo LoRA")
            .apply()
    }

    @Synchronized
    fun generate(prompt: String): String {
        check(isAvailable()) { "لم يتم تثبيت نموذج محلي بعد" }
        val modelName = preferences.getString(ACTIVE_MODEL_KEY, null)
            ?: if (baseModelFile.isFile && loraModelFile.isFile) BASE_MODEL_NAME
            else error("لم يتم اختيار نموذج محلي")
        val activeModelFile = File(modelDirectory, modelName)
        val loraName = preferences.getString(ACTIVE_LORA_KEY, null)
            ?: if (modelName == BASE_MODEL_NAME && loraModelFile.isFile) LORA_MODEL_NAME else null
        val activeLoraFile = loraName?.let { File(modelDirectory, it) }
        val activeInference = inference ?: LlmInference.createFromOptions(
            context,
            LlmInference.LlmInferenceOptions.builder()
                .setModelPath(activeModelFile.absolutePath)
                .setMaxTokens(MAX_TOKENS)
                .build(),
        ).also { inference = it }
        val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTopK(TOP_K)
            .setTemperature(TEMPERATURE)
        if (activeLoraFile?.isFile == true) sessionOptions.setLoraPath(activeLoraFile.absolutePath)
        val session = LlmInferenceSession.createFromOptions(activeInference, sessionOptions.build())
        return try {
            session.addQueryChunk(prompt)
            session.generateResponse().trim()
        } finally {
            session.close()
        }
    }

    private fun createStagingDirectory(): File =
        File(modelDirectory, ".staging-${System.currentTimeMillis()}").apply { mkdirs() }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    companion object {
        const val BASE_MODEL_NAME = "base.bin"
        const val LORA_MODEL_NAME = "lora.bin"
        private const val PREFERENCES_NAME = "zazo_local_models"
        private const val ACTIVE_MODEL_KEY = "active_model"
        private const val ACTIVE_LORA_KEY = "active_lora"
        private const val ACTIVE_MODEL_LABEL_KEY = "active_model_label"
        private const val MIN_MODEL_BYTES = 1024L * 1024L
        private const val MAX_TOKENS = 512
        private const val TOP_K = 40
        private const val TEMPERATURE = 0.7f
    }
}
