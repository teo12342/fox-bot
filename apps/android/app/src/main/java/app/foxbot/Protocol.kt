package app.foxbot

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.UUID

data class PairingOffer(val hostId: String, val endpoint: String, val secret: String, val expiresAt: Long, val publicKey: String) {
    companion object {
        fun parse(raw: String, now: Long = System.currentTimeMillis()): PairingOffer {
            val j = JSONObject(raw)
            require(j.getInt("version") == 1) { "Unsupported pairing version" }
            UUID.fromString(j.getString("hostId"))
            val uri = URI(j.getString("endpoint"))
            require(uri.scheme == "wss" && uri.host != null && uri.userInfo == null && uri.fragment == null) { "Pairing requires a secure wss endpoint" }
            val expires = j.getLong("expiresAt")
            require(expires > now && expires <= now + 300_000) { "Pairing code expired or invalid" }
            require(j.getString("secret").length >= 32 && j.getString("publicKey").length >= 32) { "Invalid pairing code" }
            return PairingOffer(j.getString("hostId"), uri.toString(), j.getString("secret"), expires, j.getString("publicKey"))
        }
    }
}

object Protocol {
    fun array(vararg values: Any): String = JSONArray(values.toList()).toString()
    fun command(type: String, payload: JSONObject) = JSONObject().put("version", 1).put("id", UUID.randomUUID().toString()).put("type", type).put("payload", payload)
    fun verificationCode(hostId: String, hostKey: String, deviceId: String, deviceKey: String): String {
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(array(1, "pair-code", hostId, hostKey, deviceId, deviceKey).toByteArray())
        return hash.take(4).joinToString("") { "%02X".format(it.toInt() and 255) }.chunked(4).joinToString(" ")
    }
}

