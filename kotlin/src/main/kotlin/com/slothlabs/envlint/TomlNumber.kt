package com.slothlabs.envlint

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A TOML numeric literal that may be written as either an integer (`min = 1`)
 * or a float (`min = 1.5`). Decoding tolerates both, mirroring serde's `f64`
 * which silently accepts integer TOML literals.
 */
@Serializable(with = TomlNumberSerializer::class)
internal data class TomlNumber(val value: Double) {
    fun toDoubleOrNull(): Double = value
}

internal object TomlNumberSerializer : KSerializer<TomlNumber> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.slothlabs.envlint.TomlNumber", PrimitiveKind.DOUBLE)

    override fun deserialize(decoder: Decoder): TomlNumber {
        // ktoml exposes integer literals as Long and float literals as Double.
        // Try the float path first; fall back to a long literal.
        val d =
            try {
                decoder.decodeDouble()
            } catch (_: Throwable) {
                decoder.decodeLong().toDouble()
            }
        return TomlNumber(d)
    }

    override fun serialize(
        encoder: Encoder,
        value: TomlNumber,
    ) {
        encoder.encodeDouble(value.value)
    }
}
