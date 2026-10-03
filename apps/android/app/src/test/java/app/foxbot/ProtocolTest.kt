package app.foxbot

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class ProtocolTest {
    private fun offer() = JSONObject().put("version", 1).put("hostId", "cfde2522-952f-4456-9be9-7daa6d151818").put("endpoint", "wss://relay.example.com").put("secret", "a".repeat(32)).put("publicKey", "b".repeat(120)).put("expiresAt", 150000L)
    @Test fun validOffer() { assertEquals("wss://relay.example.com", PairingOffer.parse(offer().toString(), 100000).endpoint) }
    @Test fun expiredRejected() { assertThrows(IllegalArgumentException::class.java) { PairingOffer.parse(offer().put("expiresAt", 90000).toString(), 100000) } }
    @Test fun insecureEndpointRejected() { assertThrows(IllegalArgumentException::class.java) { PairingOffer.parse(offer().put("endpoint", "ws://relay.example.com").toString(), 100000) } }
    @Test fun longLivedPairingRejected() { assertThrows(IllegalArgumentException::class.java) { PairingOffer.parse(offer().put("expiresAt", 500001).toString(), 100000) } }
    @Test fun commandIdsUnique() { assertNotEquals(Protocol.command("snapshot", JSONObject()).getString("id"), Protocol.command("snapshot", JSONObject()).getString("id")) }
    @Test fun canonicalRegisterMatchesNode() { assertEquals("[1,\"register\",\"device\",\"host\",\"nonce\"]", Protocol.array(1,"register","device","host","nonce")) }
}
