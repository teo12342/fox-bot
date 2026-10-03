package app.foxbot

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec

class DeviceIdentity {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "foxbot-device-v1"
    init {
        if (!store.containsAlias(alias)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
            }.generateKeyPair()
        }
    }
    val publicKey: String get() = Base64.encodeToString(store.getCertificate(alias).publicKey.encoded, Base64.NO_WRAP)
    fun sign(text: String): String = Signature.getInstance("SHA256withECDSA").run {
        initSign(store.getKey(alias, null) as java.security.PrivateKey); update(text.toByteArray(Charsets.UTF_8)); Base64.encodeToString(sign(), Base64.NO_WRAP)
    }
    fun verify(key: String, text: String, signature: String): Boolean = runCatching {
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(key, Base64.DEFAULT))))
            update(text.toByteArray(Charsets.UTF_8)); verify(Base64.decode(signature, Base64.DEFAULT))
        }
    }.getOrDefault(false)
}
