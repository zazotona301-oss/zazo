import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.Sync
import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webRoot = rootProject.projectDir.parentFile
val generatedWebAssets = layout.buildDirectory.dir("generated/reactAssets")
val configuredWebUiUrl = providers.gradleProperty("webUiUrl")
    .orElse(providers.environmentVariable("ZAZO_WEB_UI_URL"))
    .orElse("")
    .map(String::trim)
    .get()

fun normalizeWebUiUrl(rawUrl: String): String {
    if (rawUrl.isEmpty()) return ""
    val uri = try {
        URI(rawUrl)
    } catch (error: Exception) {
        throw GradleException("webUiUrl must be a valid HTTPS URL", error)
    }
    if (!uri.scheme.equals("https", ignoreCase = true) ||
        uri.host.isNullOrBlank() ||
        uri.userInfo != null
    ) {
        throw GradleException("webUiUrl must be an HTTPS URL with a hostname and no credentials")
    }
    return rawUrl.trimEnd('/')
}

val webUiUrl = normalizeWebUiUrl(configuredWebUiUrl)
val escapedWebUiUrl = webUiUrl.replace("\\", "\\\\").replace("\"", "\\\"")

val installWebDependencies = tasks.register<Exec>("installWebDependencies") {
    group = "web"
    description = "Installs the React application's locked npm dependencies."
    workingDir(webRoot)
    commandLine("npm", "ci")
    inputs.file(webRoot.resolve("package.json"))
    inputs.file(webRoot.resolve("package-lock.json"))
    outputs.dir(webRoot.resolve("node_modules"))
}

val buildWebApp = tasks.register<Exec>("buildWebApp") {
    group = "web"
    description = "Builds the React/Vite interface for the Android WebView."
    dependsOn(installWebDependencies)
    workingDir(webRoot)
    commandLine("npm", "run", "build")
    inputs.dir(webRoot.resolve("src"))
    inputs.dir(webRoot.resolve("public"))
    inputs.file(webRoot.resolve("index.html"))
    inputs.file(webRoot.resolve("vite.config.js"))
    outputs.dir(webRoot.resolve("dist"))
}

val copyWebAssets = tasks.register<Sync>("copyWebAssets") {
    group = "web"
    description = "Copies the React production build into Android app assets."
    dependsOn(buildWebApp)
    from(webRoot.resolve("dist"))
    into(generatedWebAssets)
}

android {
    namespace = "com.zazo.brain"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.zazo.brain"
        minSdk = 24
        targetSdk = 35
        // معظم هواتف Android الحديثة ARM64؛ منع تضمين x86 وARM32 يقلل حجم APK.
        ndk {
            abiFilters += "arm64-v8a"
        }
        versionCode = (providers.gradleProperty("versionCode").orNull ?: "1000000").toInt()
        versionName = providers.gradleProperty("versionName").orNull ?: "1.0.0"
        buildConfigField("String", "WEB_UI_URL", "\"$escapedWebUiUrl\"")
    }

    sourceSets.getByName("main").assets.srcDir(generatedWebAssets)

    val keystorePath = providers.environmentVariable("ANDROID_KEYSTORE_FILE").orNull
    val keystorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
    val keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
    val keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull

    signingConfigs {
        if (keystorePath != null && keystorePassword != null && keyAlias != null && keyPassword != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (keystorePath != null && keystorePassword != null && keyAlias != null && keyPassword != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        getByName("debug") {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.mediapipe:tasks-genai:0.10.27")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.google.android.gms:play-services-auth:22.0.0")
}

tasks.named("preBuild").configure {
    dependsOn(copyWebAssets)
}
