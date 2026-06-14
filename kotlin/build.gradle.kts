plugins {
    kotlin("jvm") version "2.2.20"
    kotlin("plugin.serialization") version "2.2.20"
    application
}

group = "com.slothlabs"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    api("com.akuleshov7:ktoml-core:0.7.1")

    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(17)
}

application {
    mainClass.set("com.slothlabs.envlint.MainKt")
}

tasks.test {
    useJUnitPlatform()
}
