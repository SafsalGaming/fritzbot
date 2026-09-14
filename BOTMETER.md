# Botmeter integration

Fixed bot ID: `fritz`. Helper: `lib/botmeter.cjs`.
Set `BOTMETER_URL` and `BOTMETER_INGEST_KEY` in the server deployment environment.
Use the matching central server key: `FRITZ_INGEST_KEY`.
Never put values in browser code or commit them.

Every actual OpenAI HTTP request passing through monitoredFetch gets a UUID.
Provider retries get new UUIDs; delivery retries reuse the same UUID (up to 3 attempts,
1.5 second timeout each). HTTP 4xx other than 429 is not retried.
Reporting failures do not replace provider responses or errors. Reports are awaited;
an unavailable monitor can add up to about 4.5 seconds per provider request.
There is no durable delivery queue: prolonged outages can lose events.

Usage comes from provider usage fields, including cached input as a subset of input.
Missing usage is marked usageKnown=false. No monetary costs are invented.
Image/audio tokens can have different rates: Botmeter's generic price calculation is
only an estimate; leave rates unset unless they correctly cover the billing units.
Embedding vectors and inline image files are omitted. Prompts and text are scrubbed
and limited to 30,000 characters. Error text is generic. Temporary provider/Discord
image URLs are omitted; stable storage is required for reliable previews.

Run `node --test tests/botmeter.test.cjs` for mocked monitoring checks.
Deploy both the central server and this bot to activate changes. No paid AI calls
are needed to run the tests.

## Provider call coverage

- `api/discord.js` / `callOpenAI` / `callOnce`: OpenAI Responses, `gpt-5.6-luna`, including vision inputs.
- A reasoning-only incomplete response can trigger a second call with lower reasoning effort. Both actual calls pass through monitoredFetch and receive separate UUIDs.
- `api/interactions.js` reexports the same handler. No embedding, image-generation, speech or transcription request found. The groq-sdk dependency is not used by an active call site.
