# Self-host Fox Bot connectivity

Use a public **Linux** server with Docker Engine and Docker Compose. This Compose file uses host networking for coturn and is not intended for Docker Desktop. No inbound ports are needed on the user's PC. The PC must remain awake and connected.

1. Point `SIGNALING_DOMAIN` and `TURN_DOMAIN` DNS records at your server. Ensure the TURN hostname resolves to the configured public IPv4. Do not place TURN behind an HTTP CDN proxy.
2. Copy `.env.example` to `.env`. Generate independent 32-byte secrets with `openssl rand -hex 32` for the administrator token and TURN secret. Keep `.env` private and excluded from Git. Set your real public IP and domains.
3. Open TCP 80/443 for automatic Caddy TLS, TCP/UDP 3478 for TURN, and UDP 49160–49200 for allocated relays. If the VPS has private addressing, coturn may require `--external-ip=PUBLIC/PRIVATE` instead of the public-only value. UDP 443 is optional Caddy HTTP/3.
4. Run `docker compose --env-file .env -f compose.yml up -d --build` from this directory.
5. Check `curl https://SIGNALING_DOMAIN/health` and `docker compose -f compose.yml ps`. Configure desktop endpoint `wss://SIGNALING_DOMAIN/ws` and initial administrator token. Pair the phone by QR and matching verification code.

Caddy obtains and renews a public HTTPS/WSS certificate. WebRTC media/data are DTLS encrypted even when carried by TCP TURN. This default deployment offers `turn:` UDP/TCP on 3478; add `turns:` with a correctly mounted renewed certificate for environments requiring TLS TURN on 5349. Networks allowing only HTTPS 443 may need a separate IP dedicated to TURN/TLS 443, because Caddy already occupies TCP 443. Cross-network acceptance must be tested on actual mobile data with forced relay; local signaling tests are not proof of NAT traversal.

## Operation

- **Backup:** stop signaling briefly and back up its `identity_data` volume plus `.env` into encrypted offline storage. Public keys and revocation records are security-sensitive integrity data. Preserve Caddy's volumes for certificate continuity.
- **Upgrade:** back up first, review dependency/image updates, then `docker compose -f compose.yml build --pull` and `docker compose -f compose.yml up -d`. Desktop/phone reconnect and negotiate new RTC sessions after downtime. Version changes must preserve protocol compatibility.
- **Recovery:** restore identities before restarting. Never silently clear revocation state. If the administrator token leaks, rotate it and audit host registrations. Rotate TURN secret to invalidate newly requested credentials; old issued credentials expire in ten minutes.
- **Logs:** rotation is capped at three 10 MiB files per service. Signaling never logs message contents, identities, tokens, SDP, or ICE. Do not enable reverse-proxy body/query logging. coturn emits operational connection metadata; restrict access and retention.
- **Costs:** TURN bandwidth includes uploaded and downloaded relayed audio/screens/files. Monitor server egress and coturn allocations; user quota 8 and total quota 200 limit allocations, not byte budgets. Apply provider-level egress alerts/limits.
- **Troubleshooting:** a healthy HTTPS endpoint does not prove TURN works. Verify DNS/firewall/public-IP mapping and inspect coturn metadata. Force `iceTransportPolicy:'relay'` in a diagnostic client. A PC-offline state requires waking/reconnecting the PC, not restarting the phone repeatedly.

The service contains no conversation database. Bots, provider keys, files, and execution remain on the desktop. Vercel serves the separate download website and does not host this persistent WebSocket service.
