# Fox Bot signaling protocol v1

This service transports pairing and signed WebRTC signaling. Conversation commands and files travel over the peer WebRTC data channel `fox-rpc`, never through this service. It stores public identities and revocation records, not API credentials, pairing secrets, messages, SDP, or ICE candidates.

Run `npm test` to exercise real HTTP and WebSocket sockets. Run `RELAY_ADMIN_TOKEN=<random-secret> npm start` with your shell's environment syntax; production deployment is described in `../../infra/README.md`. Connect to `wss://your-domain/ws`; development permits loopback `ws://127.0.0.1:8787/ws`. `GET /health` returns `{ok:true,protocol:1}`.

## Authentication

Each identity uses an ECDSA P-256 key. Public keys are base64-encoded DER SubjectPublicKeyInfo; signatures are base64-encoded DER ECDSA signatures produced with SHA-256 (Java `SHA256withECDSA`, Node `sign('sha256',...)`). IDs are 8–128 ASCII alphanumeric, underscore or hyphen characters. Generate unpredictable UUIDs.

1. Server sends `{type:"challenge",nonce}`. Nonce expires after 15 seconds.
2. Client sends `{type:"register",id,publicKey,nonce,signature,hostId?,token?}`.
3. Signature input is UTF-8 `JSON.stringify([1,"register",id,hostId || id,nonce])`, compact JSON with no whitespace.
4. First host registration requires the relay administrator token. Subsequent host registration verifies the persisted public key. Phones supply `hostId`, omit `token`, and prove possession of their own key. They are restricted until approved.
5. Server responds `{type:"registered",id,paired}`.

Do not put tokens in URLs or logs. Restrict operator access to the service's environment and state directory. The administrator token provisions host identities; it grants no ability to forge their signatures.

## Pairing

Host submits `{type:"offer",secret,expiresAt}`. Use a cryptographically random secret of at least 32 characters. `expiresAt` is epoch milliseconds, at most five minutes in the future. Server responds `{type:"offer_created",expiresAt}`. A new offer cancels pending requests for the previous offer.

The QR schema is `{version:1,hostId,endpoint,secret,expiresAt,publicKey}`, where endpoint includes `/ws` and publicKey pins the host identity. Phone registers first, then submits `{type:"pair",hostId,secret,name}` (name 1–64 characters). Server sends `{type:"pair_pending"}` to the phone and `{type:"pair_request",peerId,publicKey,name}` to the host. Only one pending request is accepted per offer.

**Before approval both applications must display and compare the same verification code derived from the two public keys.** Use SHA-256 over the UTF-8 compact JSON `[1,"pair-code",hostId,hostPublicKey,peerId,peerPublicKey]`, first eight hexadecimal characters. Phone uses the QR-pinned host key, and host uses the submitted peer key. Owner comparison authenticates the pairing against a malicious relay substituting a peer key. Reject a different host key or mismatched code; never approve automatically.

Host sends `{type:"approve",peerId,approved:true|false}` after owner decision. Success consumes the secret and persists trust. Both clients receive `{type:"pair_approved",hostId,peerId,publicKey}` (the other endpoint's key). Phone checks this matches its QR-pinned host key. Host saves the peer key only after human verification. Rejection sends `{type:"pair_rejected"}`. Expired pending offers send `{type:"pair_expired"}`. An expired/replayed secret fails. The desktop owns its independent persistent trust list and must not trust the relay's list alone.

Host revokes with `{type:"revoke",peerId}`; server disconnects and permanently rejects that peer ID. Host must also remove local trust and close existing RTC connections immediately. Re-pair a device with a fresh ID/key.

## Signed WebRTC messages

Send `{type:"signal",to,sessionId,seq,kind,payload,signature}`. `kind` is `offer`, `answer`, or `ice`. `payload` is a string: raw SDP for offer/answer, compact JSON RTCIceCandidateInit for ICE. Use a random fresh session ID per negotiation. `seq` starts at 1 and strictly increases for the sender/session/destination. Signature input is UTF-8 compact JSON `[1,"signal",from,to,sessionId,seq,kind,payload]`.

Relay forwards `{type:"signal",from,to,sessionId,seq,kind,payload,signature,publicKey}` only between an approved host and peer. **Recipients verify the signature using their locally pinned key, not the supplied publicKey.** Reject wrong destination, unknown session, replayed/out-of-order sequence, or changed identity. Verify before calling setRemoteDescription/addIceCandidate. Signed SDP binds its DTLS fingerprint; WebRTC DTLS encrypts the data/media transport. Buffer early ICE until an authenticated description exists. Renegotiation uses a new authenticated session. Track replay/session state across reconnect or terminate and negotiate a fresh session after reconnect.

All application changes over `fox-rpc` use shared versioned command envelopes, unique command IDs, desktop approval enforcement, and revision conflict checks. Do not use this channel until authenticated signaling is established and host local trust accepts the peer.

## TURN and limits

An authenticated host/approved peer sends `{type:"turn"}`. Response is `{type:"turn",expiresAt,iceServers:[{urls,username,credential}]}`. Credentials expire in ten minutes using coturn's standard HMAC-SHA1 REST authentication. No HTTP bearer endpoint is exposed; only authenticated WebSockets obtain credentials.

Frames are capped at 128 KiB, payload strings at 100,000 characters, queues at 1 MiB, and each socket at 100 messages per 10 seconds. Initial connections are limited to 120 per minute per source IP and 1,000 concurrent sockets. Behind Caddy, the connection rate is conservatively shared by proxy IP; client-supplied forwarding headers are not trusted. At most 128 signal sessions are tracked per socket. Protocol errors return `{type:"error",code}` without sensitive details. Health responses do not reveal host/device IDs.
