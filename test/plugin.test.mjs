// Runs the provider hooks the way new-api calls them: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plugin = await import("../plugin.js");
const { meta, convertRequest, convertResponse, convertStreamEvent, buildUpstream, modelKind, contentTypeFor } = plugin;

const CTX = { baseUrl: "https://api.elevenlabs.io", path: "/v1/audio/speech", config: {} };
const VOICE = "JBFqnCBsd6RMkjVDRZzb";
const AUDIO_B64 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0xff, 0xfb, 0x90]).toString("base64");

function convert(body, config, model) {
  const ctx = Object.assign({}, CTX, { config: config || {} });
  return convertRequest(ctx, { body: body, model: model || body.model, stream: false });
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function readme(name) {
  return readFileSync(new URL("../" + name, import.meta.url), "utf8");
}

// --- manifest ---------------------------------------------------------------

test("meta is a plain JSON literal the marketplace can read", () => {
  const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  const block = source.match(/export const meta = (\{[\s\S]*?\n\});/);
  assert.ok(block, "meta block found");
  assert.deepEqual(JSON.parse(block[1]), meta);
});

test("meta follows the community market rules", () => {
  assert.equal(meta.apiVersion, 1);
  assert.match(meta.key, /^[a-z0-9]+_elevenlabs$/);
  assert.ok(meta.key.length <= 30);
  assert.equal(meta.version, "1.0.0");
  assert.equal(meta.channelTypes, undefined);
  assert.equal(meta.baseUrl, "https://api.elevenlabs.io");
  assert.ok(meta.website.startsWith("https://"));
  assert.ok(meta.author.name && meta.author.url.startsWith("https://github.com/"));
  // new-api rc.50's channel type picker reads plugin.models.length and crashes on null.
  assert.ok(Array.isArray(meta.models) && meta.models.length > 0);
  // A provider-only plugin must not declare the task fields.
  for (const field of ["routes", "protocols", "usageSchema", "usageProfiles", "usageExamples", "fetchMode", "auth"]) {
    assert.equal(meta[field], undefined, field);
  }
});

test("one relay route: /v1/audio/speech through the convert hooks, key in xi-api-key", () => {
  assert.equal(meta.relay.length, 1);
  const route = meta.relay[0];
  assert.equal(route.incoming_path, "/v1/audio/speech");
  assert.equal(route.converter, "plugin");
  assert.deepEqual(route.auth, { type: "header", name: "xi-api-key", value: "{" + "api_key" + "}" });
  assert.equal(typeof convertRequest, "function");
  assert.equal(typeof convertResponse, "function");
  assert.equal(typeof convertStreamEvent, "function");
});

test("every model has a kind and a recommended billing expression in both READMEs", () => {
  const en = readme("README.md");
  const zh = readme("README.zh-CN.md");
  for (const model of meta.models) {
    assert.ok(["tts", "music", "sfx"].includes(modelKind(model)), model);
    assert.ok(en.includes("`" + model + "`"), "README.md mentions " + model);
    assert.ok(zh.includes("`" + model + "`"), "README.zh-CN.md mentions " + model);
  }
  for (const expr of [
    'tier("base", p * 80)',
    'tier("base", p * 40)',
    'tier("base", float(param("metadata.music_length_ms") ?? 0) * 2.5)',
    'tier("base", float(param("metadata.duration_seconds") ?? 0) * 2000)',
  ]) {
    assert.ok(en.includes(expr), "README.md has " + expr);
    assert.ok(zh.includes(expr), "README.zh-CN.md has " + expr);
  }
});

test("model kinds", () => {
  assert.equal(modelKind("eleven_v4"), "tts");
  assert.equal(modelKind("eleven_flash_v2_5"), "tts");
  assert.equal(modelKind("eleven_turbo_v2_5"), "tts");
  assert.equal(modelKind("music_v2_5"), "music");
  assert.equal(modelKind("music_v2"), "music");
  assert.equal(modelKind("eleven_text_to_sound_v3"), "sfx");
  assert.equal(modelKind("eleven_text_to_sound_v2"), "sfx");
});

// --- text to speech -----------------------------------------------------------

test("speech: OpenAI body maps to /v1/text-to-speech/{voice_id}", () => {
  const r = convert({ model: "eleven_v3", input: "Hello there", voice: "VoiceAbc123" });
  assert.deepEqual(r, {
    path: "/v1/text-to-speech/VoiceAbc123?output_format=mp3_44100_128",
    method: "POST",
    body: { text: "Hello there", model_id: "eleven_v3" },
    stream: false,
    state: { model: "eleven_v3", kind: "tts", format: "mp3_44100_128" },
  });
});

test("speech: the upstream (mapped) model is used, not the client alias", () => {
  const r = convert({ model: "tts-hd", input: "Hi", voice: "VoiceAbc123" }, {}, "eleven_multilingual_v2");
  assert.equal(r.body.model_id, "eleven_multilingual_v2");
});

test("speech: OpenAI voice names and an empty voice use the channel default voice", () => {
  assert.ok(convert({ model: "eleven_v3", input: "Hi", voice: "alloy" }).path.startsWith("/v1/text-to-speech/" + VOICE + "?"));
  assert.ok(convert({ model: "eleven_v3", input: "Hi", voice: "Nova" }).path.startsWith("/v1/text-to-speech/" + VOICE + "?"));
  assert.ok(convert({ model: "eleven_v3", input: "Hi" }).path.startsWith("/v1/text-to-speech/" + VOICE + "?"));
  const custom = convert({ model: "eleven_v3", input: "Hi", voice: "alloy" }, { defaultVoiceId: "MyVoice42" });
  assert.ok(custom.path.startsWith("/v1/text-to-speech/MyVoice42?"));
});

test("speech: metadata.voice_id wins over voice", () => {
  const r = convert({ model: "eleven_v3", input: "Hi", voice: "alloy", metadata: { voice_id: "Meta1234" } });
  assert.ok(r.path.startsWith("/v1/text-to-speech/Meta1234?"));
});

test("speech: response_format maps to ElevenLabs output formats", () => {
  const cases = { mp3: "mp3_44100_128", opus: "opus_48000_128", wav: "wav_44100", pcm: "pcm_24000" };
  for (const [rf, of] of Object.entries(cases)) {
    const r = convert({ model: "eleven_v3", input: "Hi", voice: "alloy", response_format: rf });
    assert.ok(r.path.endsWith("?output_format=" + of), rf);
    assert.equal(r.state.format, of);
  }
  const native = convert({ model: "eleven_v3", input: "Hi", voice: "alloy", response_format: "wav", metadata: { output_format: "pcm_44100" } });
  assert.ok(native.path.endsWith("?output_format=pcm_44100"));
});

test("speech: ElevenLabs options pass through metadata", () => {
  const r = convert({
    model: "eleven_multilingual_v2",
    input: "Bonjour",
    voice: "VoiceAbc123",
    metadata: {
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
      language_code: "fr",
      seed: 42,
      previous_text: "Avant.",
      next_text: "Après.",
      apply_text_normalization: "on",
      apply_language_text_normalization: false,
      use_pvc_as_ivc: true,
      audio_effects: { pan: 0 },
    },
  });
  assert.deepEqual(r.body, {
    text: "Bonjour",
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
    language_code: "fr",
    seed: 42,
    previous_text: "Avant.",
    next_text: "Après.",
    apply_text_normalization: "on",
    apply_language_text_normalization: false,
    use_pvc_as_ivc: true,
    audio_effects: { pan: 0 },
  });
});

test("speech: speed goes into voice_settings within ElevenLabs' range", () => {
  const r = convert({ model: "eleven_flash_v2_5", input: "Hi", voice: "alloy", speed: 1.1, metadata: { voice_settings: { stability: 0.5 } } });
  assert.deepEqual(r.body.voice_settings, { stability: 0.5, speed: 1.1 });
  assert.equal(convert({ model: "eleven_flash_v2_5", input: "Hi", voice: "alloy", speed: 1 }).body.voice_settings, undefined);
  assert.throws(() => convert({ model: "eleven_flash_v2_5", input: "Hi", voice: "alloy", speed: 2 }), /speed must be between 0.7 and 1.2/);
  assert.throws(() => convert({ model: "eleven_v3", input: "Hi", voice: "alloy", speed: 0.8, metadata: { voice_settings: { speed: 0.9 } } }), /differ/);
  assert.throws(() => convert({ model: "eleven_v4", input: "Hi", voice: "alloy", speed: 0.9 }), /eleven_v4 has no speed control/);
  assert.throws(() => convert({ model: "eleven_v4", input: "Hi", voice: "alloy", metadata: { voice_settings: { speed: 0.9 } } }), /no speed control/);
});

test("speech: per-model character limits count characters, not UTF-16 units", () => {
  assert.doesNotThrow(() => convert({ model: "eleven_v3", input: "a".repeat(5000), voice: "alloy" }));
  assert.throws(() => convert({ model: "eleven_v3", input: "a".repeat(5001), voice: "alloy" }), /input is limited to 5000 characters/);
  assert.doesNotThrow(() => convert({ model: "eleven_v3", input: "😀".repeat(5000), voice: "alloy" }));
  assert.doesNotThrow(() => convert({ model: "eleven_flash_v2_5", input: "a".repeat(40000), voice: "alloy" }));
  assert.throws(() => convert({ model: "eleven_v4", input: "a".repeat(10001), voice: "alloy" }), /10000 characters/);
});

test("speech: zero retention adds enable_logging=false", () => {
  const r = convert({ model: "eleven_v3", input: "Hi", voice: "alloy" }, { zeroRetention: true });
  assert.equal(r.path, "/v1/text-to-speech/" + VOICE + "?output_format=mp3_44100_128&enable_logging=false");
});

// --- music ------------------------------------------------------------------------

test("music: prompt and the billed length go to /v1/music", () => {
  const r = convert({ model: "music_v2_5", input: "Lo-fi beat with rain", voice: "alloy", metadata: { music_length_ms: 30000, force_instrumental: true, seed: 7, lyrics_text: "la la", use_phonetic_names: true, sign_with_c2pa: true } });
  assert.deepEqual(r, {
    path: "/v1/music?output_format=mp3_44100_128",
    method: "POST",
    body: { prompt: "Lo-fi beat with rain", model_id: "music_v2_5", music_length_ms: 30000, force_instrumental: true, seed: 7, lyrics_text: "la la", use_phonetic_names: true, sign_with_c2pa: true },
    stream: false,
    state: { model: "music_v2_5", kind: "music", format: "mp3_44100_128" },
  });
});

test("music: the length is required and bounded, since it is what the expression bills", () => {
  assert.throws(() => convert({ model: "music_v2", input: "x", voice: "alloy" }), /metadata.music_length_ms is required/);
  assert.throws(() => convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 2999 } }), /between 3000 and 600000/);
  assert.throws(() => convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 600001 } }), /between 3000 and 600000/);
  assert.throws(() => convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 10000.5 } }), /must be an integer/);
  assert.throws(() => convert({ model: "music_v2", input: "x", metadata: { music_length_ms: "10000" } }), /must be a number/);
});

test("music: account-bound and plan options are rejected, wav is not offered", () => {
  for (const name of ["composition_plan", "finetune_id", "store_for_inpainting", "music_prompt", "generation_mode"]) {
    assert.throws(() => convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 10000, [name]: {} } }), new RegExp("metadata." + name + " is not supported"));
  }
  assert.throws(() => convert({ model: "music_v2", input: "x", response_format: "wav", metadata: { music_length_ms: 10000 } }), /not available for music/);
  assert.throws(() => convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 10000, output_format: "wav_44100" } }), /metadata.output_format must be one of/);
  assert.ok(convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 10000, output_format: "mp3_48000_192" } }).path.endsWith("mp3_48000_192"));
  assert.throws(() => convert({ model: "music_v2", input: "x", response_format: "pcm", metadata: { music_length_ms: 10000, sign_with_c2pa: true } }), /needs an mp3/);
  assert.throws(() => convert({ model: "music_v2", input: "x".repeat(4101), metadata: { music_length_ms: 10000 } }), /4100 characters/);
  assert.throws(() => convert({ model: "music_v2", input: "x", speed: 1.1, metadata: { music_length_ms: 10000 } }), /speed is not supported for music/);
});

// --- sound effects -------------------------------------------------------------------

test("sound effects: text and the billed duration go to /v1/sound-generation", () => {
  const r = convert({ model: "eleven_text_to_sound_v3", input: "Door creak", voice: "alloy", response_format: "wav", metadata: { duration_seconds: 2.5, loop: true, prompt_influence: 0.6 } });
  assert.deepEqual(r, {
    path: "/v1/sound-generation?output_format=wav_44100",
    method: "POST",
    body: { text: "Door creak", model_id: "eleven_text_to_sound_v3", duration_seconds: 2.5, loop: true, prompt_influence: 0.6 },
    stream: false,
    state: { model: "eleven_text_to_sound_v3", kind: "sfx", format: "wav_44100" },
  });
});

test("sound effects: duration is required and bounded", () => {
  assert.throws(() => convert({ model: "eleven_text_to_sound_v3", input: "x" }), /metadata.duration_seconds is required/);
  assert.throws(() => convert({ model: "eleven_text_to_sound_v3", input: "x", metadata: { duration_seconds: 0.4 } }), /between 0.5 and 30/);
  assert.throws(() => convert({ model: "eleven_text_to_sound_v3", input: "x", metadata: { duration_seconds: 31 } }), /between 0.5 and 30/);
  assert.throws(() => convert({ model: "eleven_text_to_sound_v3", input: "x", metadata: { duration_seconds: 5, prompt_influence: 2 } }), /between 0 and 1/);
  assert.throws(() => convert({ model: "eleven_text_to_sound_v3", input: "x", metadata: { duration_seconds: 5, voice_settings: {} } }), /not an option of sound effects/);
});

// --- validation shared by all models -------------------------------------------------

test("validation errors are readable sentences", () => {
  const base = { model: "eleven_v3", input: "Hi", voice: "alloy" };
  assert.throws(() => convert(Object.assign({}, base, { input: "  " })), /input is required/);
  assert.throws(() => convert(Object.assign({}, base, { instructions: "calm" })), /instructions is not supported/);
  assert.doesNotThrow(() => convert(Object.assign({}, base, { instructions: "" })));
  assert.throws(() => convert(Object.assign({}, base, { stream_format: "sse" })), /stream_format sse is not supported/);
  assert.doesNotThrow(() => convert(Object.assign({}, base, { stream_format: "audio" })));
  assert.throws(() => convert(Object.assign({}, base, { response_format: "aac" })), /response_format "aac" is not supported/);
  assert.throws(() => convert(Object.assign({}, base, { response_format: "flac" })), /not supported/);
  assert.throws(() => convert(Object.assign({}, base, { voice: "../v1/user" })), /voice must be an ElevenLabs voice ID/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: "x" })), /metadata must be an object/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { foo: 1 } })), /metadata.foo is not an option of text to speech/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { previous_request_ids: ["a"] } })), /references generations of the gateway's ElevenLabs account/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { pronunciation_dictionary_locators: [] } })), /dictionaries/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { text: "x" } })), /the text goes in input/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { voice_settings: { pitch: 1 } } })), /voice_settings.pitch is not supported/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { voice_settings: { stability: 1.5 } } })), /between 0 and 1/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { language_code: "English" } })), /ISO 639/);
  assert.throws(() => convert(Object.assign({}, base, { metadata: { seed: -1 } })), /metadata.seed/);
  assert.throws(() => convert(base, { defaultVoiceId: "bad voice" }), /default voice ID is invalid/);
  assert.throws(() => convertRequest(Object.assign({}, CTX, { path: "/v1/chat/completions" }), { body: base, model: "eleven_v3" }), /only serves \/v1\/audio\/speech/);
  assert.throws(() => convertRequest(CTX, { body: null, model: "eleven_v3" }), /JSON body is required/);
  assert.throws(() => buildUpstream({ input: "x" }, ""), /model is required/);
});

test("hooks do not mutate their arguments", () => {
  const ctx = deepFreeze(Object.assign({}, CTX, { config: { defaultVoiceId: "MyVoice42", zeroRetention: true } }));
  const req = deepFreeze({ body: { model: "eleven_v3", input: "Hi", voice: "alloy", speed: 1.1, metadata: { voice_settings: { stability: 0.4 } } }, model: "eleven_v3", stream: false });
  const r = convertRequest(ctx, req);
  assert.deepEqual(r.body.voice_settings, { stability: 0.4, speed: 1.1 });
  const resp = deepFreeze({ status: 200, headers: { "Content-Type": "audio/mpeg" }, bodyBase64: AUDIO_B64 });
  assert.equal(convertResponse(deepFreeze(Object.assign({}, CTX, { state: r.state })), resp).bodyBase64, AUDIO_B64);
});

// --- responses -----------------------------------------------------------------------------

test("audio passes through as base64 with the upstream content type", () => {
  const ctx = Object.assign({}, CTX, { state: { model: "eleven_v3", kind: "tts", format: "mp3_44100_128" } });
  assert.deepEqual(convertResponse(ctx, { status: 200, headers: { "Content-Type": "audio/mpeg" }, bodyBase64: AUDIO_B64 }), { bodyBase64: AUDIO_B64, contentType: "audio/mpeg" });
  const wav = Object.assign({}, CTX, { state: { format: "wav_44100" } });
  assert.deepEqual(convertResponse(wav, { status: 200, headers: { "Content-Type": "application/octet-stream" }, bodyBase64: AUDIO_B64 }), { bodyBase64: AUDIO_B64, contentType: "audio/wav" });
  assert.deepEqual(convertResponse(Object.assign({}, CTX, { state: null }), { status: 200, headers: {}, bodyBase64: AUDIO_B64 }), { bodyBase64: AUDIO_B64, contentType: "application/octet-stream" });
});

test("content types by output format", () => {
  assert.equal(contentTypeFor("mp3_44100_128"), "audio/mpeg");
  assert.equal(contentTypeFor("opus_48000_64"), "audio/ogg");
  assert.equal(contentTypeFor("pcm_24000"), "audio/pcm");
  assert.equal(contentTypeFor("ulaw_8000"), "audio/basic");
  assert.equal(contentTypeFor(undefined), "application/octet-stream");
});

test("ElevenLabs errors keep their status and code and are not billed", () => {
  const ctx = Object.assign({}, CTX, { state: { format: "mp3_44100_128" } });
  assert.deepEqual(
    convertResponse(ctx, { status: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ detail: { status: "voice_not_found", message: "A voice with voice_id x was not found." } }) }),
    { error: { status: 400, message: "ElevenLabs: A voice with voice_id x was not found.", type: "upstream_error", code: "voice_not_found" } },
  );
  assert.deepEqual(
    convertResponse(ctx, { status: 401, headers: {}, body: JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }) }).error,
    { status: 401, message: "ElevenLabs: This request exceeds your quota.", type: "upstream_error", code: "quota_exceeded" },
  );
  assert.deepEqual(
    convertResponse(ctx, { status: 422, headers: {}, body: JSON.stringify({ detail: [{ loc: ["body", "music_length_ms"], msg: "Input should be less than or equal to 600000", type: "less_than_equal" }] }) }).error,
    { status: 422, message: "ElevenLabs: music_length_ms: Input should be less than or equal to 600000", type: "upstream_error", code: "invalid_request" },
  );
  assert.deepEqual(convertResponse(ctx, { status: 503, headers: {}, body: "Service Unavailable" }).error, { status: 503, message: "ElevenLabs: Service Unavailable", type: "upstream_error" });
  assert.deepEqual(convertResponse(ctx, { status: 429, headers: {}, body: JSON.stringify({ detail: "Too many concurrent requests" }) }).error, { status: 429, message: "ElevenLabs: Too many concurrent requests", type: "upstream_error" });
});

test("a 2xx reply without audio is an error, not an empty file", () => {
  const ctx = Object.assign({}, CTX, { state: { format: "mp3_44100_128" } });
  const r = convertResponse(ctx, { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ detail: { message: "odd" } }) });
  assert.deepEqual(r, { error: { status: 502, message: "ElevenLabs returned no audio: odd", type: "upstream_error" } });
});

test("an unexpected stream fails instead of corrupting audio", () => {
  const r = convertStreamEvent(Object.assign({}, CTX, { state: null }), { data: "x" });
  assert.equal(r.error.status, 502);
});

// --- billing facts --------------------------------------------------------------------------

test("the billed quantities reach ElevenLabs unchanged", () => {
  // The README expressions read metadata.music_length_ms / metadata.duration_seconds
  // from the client body and p = input characters; the upstream body must carry
  // exactly those values so the charge matches the generated audio.
  const music = convert({ model: "music_v2", input: "x", metadata: { music_length_ms: 45000 } });
  assert.equal(music.body.music_length_ms, 45000);
  const sfx = convert({ model: "eleven_text_to_sound_v3", input: "x", metadata: { duration_seconds: 12.5 } });
  assert.equal(sfx.body.duration_seconds, 12.5);
  const text = "你好，世界 hello";
  const tts = convert({ model: "eleven_v3", input: text, voice: "alloy" });
  assert.equal(tts.body.text, text);
});
