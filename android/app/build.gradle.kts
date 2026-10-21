import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.Sync

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webRoot = rootProject.projectDir.parentFile
val generatedWebAssets = layout.buildDirectory.dir("generated/reactAssets")

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
        versionCode = (providers.gradleProperty("versionCode").orNull ?: "1000000").toInt()
        versionName = providers.gradleProperty("versionName").orNull ?: "1.0.0"
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
}

tasks.named("preBuild").configure {
    dependsOn(copyWebAssets)
}
