plugins {
    kotlin("jvm") version "2.2.20"
    kotlin("plugin.serialization") version "2.2.20"
    application
    `maven-publish`
}

group = "com.slothlabs"

// JitPack (and the release-maven workflow) pass the tag as -Pversion=<tag>.
// Strip a leading "v" so a tag like "v0.1.0" yields a clean "0.1.0".
version = (findProperty("version") as String?)?.removePrefix("v") ?: "0.1.0"

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

java {
    withSourcesJar()
    withJavadocJar()
}

application {
    mainClass.set("com.slothlabs.envlint.MainKt")
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            pom {
                name.set("envlint")
                description.set(
                    "Schema-driven validator and linter for environment variables and .env files.",
                )
                url.set("https://github.com/slothlabsorg/envlint")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("slothlabsorg")
                        name.set("SlothLabs")
                        url.set("https://github.com/slothlabsorg")
                    }
                }
                scm {
                    url.set("https://github.com/slothlabsorg/envlint")
                    connection.set("scm:git:https://github.com/slothlabsorg/envlint.git")
                    developerConnection.set("scm:git:ssh://git@github.com/slothlabsorg/envlint.git")
                }
            }
        }
    }
    repositories {
        // Only register the GitHub Packages repository when credentials are
        // present (i.e. in the release-maven workflow). This keeps local builds
        // and `publishToMavenLocal` working without any GitHub token.
        val gprToken = System.getenv("GITHUB_TOKEN")
        if (gprToken != null) {
            maven {
                name = "gpr"
                url = uri("https://maven.pkg.github.com/slothlabsorg/envlint")
                credentials {
                    username = System.getenv("GITHUB_ACTOR")
                    password = gprToken
                }
            }
        }
    }
}
