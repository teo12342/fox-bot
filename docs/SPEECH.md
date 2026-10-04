# Speech adapter (development)

`apps/desktop/runtime/speech.ts` implements recorded-file transcription and cancellable binary/streamed synthesis. Main-process desktop IPC and the standalone `VoicePanel.tsx` now connect this adapter to explicit microphone recording, transcript review, and generated-audio playback. The panel must be mounted by the desktop renderer. No live Realtime session or browser speech-recognition fallback is implemented. Fixture tests validate transport contracts without live credentials.

Instantiate `SpeechAdapter` in the trusted worker/main boundary with a vault credential callback. `transcribe(profile, input, signal)` accepts bounded audio bytes and returns text. `synthesizeStream` returns MIME, requested format, an async byte iterator, and cancellation; `synthesize` collects the bounded result. Save resulting audio in an artifact and return an artifact ID to the renderer, never the provider key. UI integration must disclose when recordings/text are sent to a cloud endpoint and label synthesized voice as AI generated.

Current desktop IPC uses `speech.transcribe` with `{requestId,providerId,base64,filename,mime,model?}` and `speech.synthesize` with `{requestId,providerId,text,model?,voice?,format?}`; synthesis returns only bounded base64 audio/MIME/format. `speech.cancel` aborts a request by UUID. Requests are restricted to the trusted desktop main frame, provider keys are read only from the vault, and hiding/quitting/crashing the renderer cancels active speech. The panel stops microphone tracks on close and never uploads a recording automatically. Compatible audio support must be explicitly confirmed and model names supplied.

OpenAI uses multipart `/audio/transcriptions` and binary `/audio/speech`. xAI uses multipart `/stt` (file last) and native JSON `/tts` with `voice_id` and `output_format`. Capability constants distinguish formats and explicitly mark live Realtime conversation unavailable. Models and voice identifiers are configurable and depend on provider access.

Local/compatible endpoints use the OpenAI-compatible routes and require explicit capability declarations. `local` requires loopback; unauthenticated local servers require explicit `auth: none`. The adapter does not download or start a local speech model. External HTTP, URL credentials/query/fragment, redirects, malformed containers, unsupported MIME/format pairs, and oversized inputs/results are rejected. Files are capped at 25,000,000 bytes, synthesized text at 4096 characters, binary output at 32,000,000 bytes, and requests at 120 seconds. These are conservative Fox Bot bounds, not a claim about every provider limit.

Official contracts checked on 2026-10-04:

- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI speech synthesis](https://developers.openai.com/api/docs/guides/text-to-speech)
- [xAI speech transcription](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)
- [xAI speech synthesis](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech)

Further acceptance requires a configured account/local service, microphone consent, real audio quality checks, playback interruption, and desktop/mobile end-to-end voice tests. A passing fixture suite does not establish those features.
