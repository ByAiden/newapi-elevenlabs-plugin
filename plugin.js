// ElevenLabs: serves the OpenAI-compatible POST /v1/audio/speech endpoint on a
// type-61 channel and answers with the audio bytes ElevenLabs returns.
//
// One client endpoint, three ElevenLabs APIs, chosen by the upstream model:
//   - Text to speech (eleven_v4, eleven_v3, eleven_multilingual_v2, Flash):
//     POST /v1/text-to-speech/{voice_id}
//   - Music (music_v2_5, music_v2): POST /v1/music
//   - Sound effects (eleven_text_to_sound_v3): POST /v1/sound-generation
//
// new-api parses /v1/audio/speech bodies into the OpenAI fields (model, input,
// voice, instructions, response_format, speed, stream_format, metadata), so
// ElevenLabs options travel in `metadata`. Billing is new-api's: the input
// characters for speech, and the requested length in metadata for music and
// sound effects, read by a billing expression with param(). Every
// price-determining value is required and validated here, so the audio
// delivered always matches what the expression charged.

export const meta = {
  "apiVersion": 1,
  "key": "byaiden_elevenlabs",
  "name": { "en": "ElevenLabs", "zh": "ElevenLabs" },
  "version": "1.0.1",
  "author": { "name": "ByAiden", "url": "https://github.com/ByAiden" },
  "description": {
    "en": "ElevenLabs text to speech, music and sound effects on the OpenAI-compatible speech endpoint",
    "zh": "通过 OpenAI 兼容的语音接口提供 ElevenLabs 文本转语音、音乐生成和音效生成"
  },
  "icon": "ElevenLabs",
  "website": "https://elevenlabs.io",
  "baseUrl": "https://api.elevenlabs.io",
  "models": [
    "eleven_v4",
    "eleven_v3",
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_flash_v2",
    "music_v2_5",
    "music_v2",
    "eleven_text_to_sound_v3"
  ],
  "relay": [
    {
      "incoming_path": "/v1/audio/speech",
      "upstream_path": "/v1/text-to-speech",
      "converter": "plugin",
      "auth": { "type": "header", "name": "xi-api-key", "value": "{api_key}" }
    }
  ],
  "channelConfig": {
    "type": "object",
    "properties": {
      "defaultVoiceId": {
        "type": "string",
        "title": { "en": "Default voice ID", "zh": "默认音色 ID" },
        "description": {
          "en": "ElevenLabs voice used when the request names an OpenAI voice such as alloy or none at all",
          "zh": "请求使用 alloy 等 OpenAI 音色名或未指定音色时使用的 ElevenLabs 音色"
        },
        "default": "JBFqnCBsd6RMkjVDRZzb",
        "minLength": 1,
        "maxLength": 64,
        "pattern": "^[A-Za-z0-9]+$"
      },
      "zeroRetention": {
        "type": "boolean",
        "title": { "en": "Zero retention mode", "zh": "零保留模式" },
        "description": {
          "en": "Send enable_logging=false so ElevenLabs keeps no history; enterprise accounts only",
          "zh": "发送 enable_logging=false，ElevenLabs 不保留历史记录；仅企业账号可用"
        },
        "default": false
      }
    }
  },
  "keyHint": {
    "en": "ElevenLabs API key, sent as the xi-api-key header",
    "zh": "ElevenLabs API 密钥，以 xi-api-key 请求头发送"
  }
};

const SPEECH_PATH = "/v1/audio/speech";

// Character limit per request of each text to speech model.
const TTS_CHAR_LIMITS = {
  eleven_v4: 10000,
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
  eleven_flash_v2_5: 40000,
  eleven_flash_v2: 30000
};
// Models without a speed control.
const NO_SPEED_MODELS = { eleven_v4: true };
const DEFAULT_TTS_CHAR_LIMIT = 40000;
const MUSIC_PROMPT_LIMIT = 4100;
const MUSIC_LYRICS_LIMIT = 4000;
const MUSIC_MIN_MS = 3000;
const MUSIC_MAX_MS = 600000;
const SFX_MIN_SECONDS = 0.5;
const SFX_MAX_SECONDS = 30;
const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;

const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin",
  "nova", "onyx", "sage", "shimmer", "verse"
];

const COMMON_FORMATS = [
  "mp3_22050_32", "mp3_24000_48", "mp3_44100_32", "mp3_44100_64", "mp3_44100_96",
  "mp3_44100_128", "mp3_44100_192",
  "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_32000", "pcm_44100", "pcm_48000",
  "ulaw_8000", "alaw_8000",
  "opus_48000_32", "opus_48000_64", "opus_48000_96", "opus_48000_128", "opus_48000_192"
];
const WAV_FORMATS = ["wav_8000", "wav_16000", "wav_22050", "wav_24000", "wav_32000", "wav_44100", "wav_48000"];
const MUSIC_EXTRA_FORMATS = ["mp3_48000_128", "mp3_48000_192", "mp3_48000_240", "mp3_48000_320"];

// OpenAI response_format -> ElevenLabs output_format. OpenAI pcm is 24 kHz
// 16-bit little-endian mono, the same as pcm_24000.
const RESPONSE_FORMATS = {
  mp3: "mp3_44100_128",
  opus: "opus_48000_128",
  wav: "wav_44100",
  pcm: "pcm_24000"
};

const KINDS = {
  tts: {
    label: "Text to speech",
    formats: COMMON_FORMATS.concat(WAV_FORMATS),
    options: [
      "voice_id", "output_format", "voice_settings", "language_code", "seed", "previous_text",
      "next_text", "apply_text_normalization", "apply_language_text_normalization", "use_pvc_as_ivc",
      "audio_effects"
    ]
  },
  music: {
    label: "Music",
    formats: COMMON_FORMATS.concat(MUSIC_EXTRA_FORMATS),
    options: ["music_length_ms", "output_format", "force_instrumental", "seed", "lyrics_text", "use_phonetic_names", "sign_with_c2pa"]
  },
  sfx: {
    label: "Sound effects",
    formats: COMMON_FORMATS.concat(WAV_FORMATS),
    options: ["duration_seconds", "output_format", "loop", "prompt_influence"]
  }
};

// Options that address resources of the ElevenLabs account behind the channel
// (history, dictionaries, finetunes, stored songs) or change how a song is
// priced. Rejected with a reason instead of dropped silently.
const REJECTED_OPTIONS = {
  previous_request_ids: "it references generations of the gateway's ElevenLabs account",
  next_request_ids: "it references generations of the gateway's ElevenLabs account",
  pronunciation_dictionary_locators: "it references dictionaries of the gateway's ElevenLabs account",
  finetune_id: "it references finetunes of the gateway's ElevenLabs account",
  finetune_strength: "it only applies to finetunes of the gateway's ElevenLabs account",
  store_for_inpainting: "it stores songs in the gateway's ElevenLabs account",
  composition_plan: "the song length is billed from metadata.music_length_ms; send a prompt in input",
  music_prompt: "it is deprecated by ElevenLabs; send a prompt in input",
  respect_sections_durations: "it only applies to composition plans",
  generation_mode: "it is not part of the public ElevenLabs music API",
  enable_logging: "zero retention mode is a channel setting",
  optimize_streaming_latency: "it only applies to streaming",
  text: "the text goes in input",
  prompt: "the prompt goes in input",
  model_id: "the model goes in model"
};

const VOICE_SETTINGS = {
  stability: [0, 1],
  similarity_boost: [0, 1],
  style: [0, 1],
  speed: [SPEED_MIN, SPEED_MAX],
  clone_strength: [0, 1],
  use_speaker_boost: "boolean"
};

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function present(value) {
  return value !== undefined && value !== null;
}

function charCount(text) {
  return Array.from(text).length;
}

function finiteNumber(value, name, min, max) {
  if (typeof value !== "number" || !isFinite(value)) fail(name + " must be a number.");
  if (value < min || value > max) fail(name + " must be between " + min + " and " + max + ".");
  return value;
}

function integer(value, name, min, max) {
  finiteNumber(value, name, min, max);
  if (Math.floor(value) !== value) fail(name + " must be an integer.");
  return value;
}

function bool(value, name) {
  if (typeof value !== "boolean") fail(name + " must be true or false.");
  return value;
}

function text(value, name, maxChars) {
  if (typeof value !== "string") fail(name + " must be a string.");
  if (maxChars && charCount(value) > maxChars) fail(name + " is limited to " + maxChars + " characters.");
  return value;
}

export function modelKind(model) {
  const m = String(model || "");
  if (m.indexOf("music_") === 0) return "music";
  if (m.indexOf("eleven_text_to_sound") === 0) return "sfx";
  return "tts";
}

function readMetadata(body, kind, model) {
  const metadata = body.metadata;
  if (!present(metadata)) return {};
  if (!isObject(metadata)) fail("metadata must be an object of ElevenLabs options.");
  const allowed = KINDS[kind].options;
  Object.keys(metadata).forEach(function (name) {
    if (REJECTED_OPTIONS[name]) fail("metadata." + name + " is not supported: " + REJECTED_OPTIONS[name] + ".");
    if (allowed.indexOf(name) < 0) {
      fail("metadata." + name + " is not an option of " + KINDS[kind].label.toLowerCase() + " (" + model + "). Supported: " + allowed.join(", ") + ".");
    }
  });
  return metadata;
}

function outputFormat(body, metadata, kind) {
  const formats = KINDS[kind].formats;
  if (present(metadata.output_format)) {
    const f = metadata.output_format;
    if (typeof f !== "string" || formats.indexOf(f) < 0) {
      fail("metadata.output_format must be one of: " + formats.join(", ") + ".");
    }
    return f;
  }
  const rf = present(body.response_format) && body.response_format !== "" ? body.response_format : "mp3";
  const mapped = RESPONSE_FORMATS[rf];
  if (!mapped) fail("response_format " + JSON.stringify(rf) + " is not supported; use mp3, opus, wav or pcm, or set metadata.output_format.");
  if (formats.indexOf(mapped) < 0) fail("response_format " + rf + " is not available for " + KINDS[kind].label.toLowerCase() + "; use mp3, opus or pcm.");
  return mapped;
}

function checkCommon(body) {
  if (present(body.instructions) && body.instructions !== "") {
    fail("instructions is not supported by ElevenLabs; for eleven_v3 and eleven_v4 put audio tags such as [whispers] into input.");
  }
  if (body.stream_format === "sse") fail("stream_format sse is not supported; the audio is returned in one response.");
  if (present(body.stream_format) && body.stream_format !== "" && body.stream_format !== "audio") {
    fail("stream_format must be audio.");
  }
  if (typeof body.input !== "string" || body.input.trim() === "") fail("input is required.");
}

function speechVoice(body, metadata, config) {
  if (present(metadata.voice_id)) {
    const id = metadata.voice_id;
    if (typeof id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(id)) fail("metadata.voice_id must be an ElevenLabs voice ID.");
    return id;
  }
  const voice = typeof body.voice === "string" ? body.voice.trim() : "";
  if (voice === "" || OPENAI_VOICES.indexOf(voice.toLowerCase()) >= 0) {
    const fallback = String((config && config.defaultVoiceId) || "JBFqnCBsd6RMkjVDRZzb");
    if (!/^[A-Za-z0-9]{1,64}$/.test(fallback)) fail("The channel's default voice ID is invalid.");
    return fallback;
  }
  if (!/^[A-Za-z0-9]{1,64}$/.test(voice)) {
    fail("voice must be an ElevenLabs voice ID (letters and digits), such as JBFqnCBsd6RMkjVDRZzb.");
  }
  return voice;
}

function voiceSettings(value, model) {
  if (!isObject(value)) fail("metadata.voice_settings must be an object.");
  const out = {};
  Object.keys(value).forEach(function (name) {
    const rule = VOICE_SETTINGS[name];
    if (!rule) fail("metadata.voice_settings." + name + " is not supported. Supported: " + Object.keys(VOICE_SETTINGS).join(", ") + ".");
    const v = value[name];
    if (!present(v)) return;
    if (rule === "boolean") out[name] = bool(v, "metadata.voice_settings." + name);
    else out[name] = finiteNumber(v, "metadata.voice_settings." + name, rule[0], rule[1]);
  });
  if (present(out.speed) && NO_SPEED_MODELS[model]) fail(model + " has no speed control; leave speed unset.");
  return out;
}

function querySuffix(format, config) {
  let q = "?output_format=" + encodeURIComponent(format);
  if (config && config.zeroRetention === true) q += "&enable_logging=false";
  return q;
}

function buildSpeech(body, model, metadata, config) {
  const limit = TTS_CHAR_LIMITS[model] || DEFAULT_TTS_CHAR_LIMIT;
  text(body.input, "input", limit);
  const voice = speechVoice(body, metadata, config);
  const format = outputFormat(body, metadata, "tts");
  const out = { text: body.input, model_id: model };
  if (present(metadata.voice_settings)) out.voice_settings = voiceSettings(metadata.voice_settings, model);
  if (present(body.speed) && body.speed !== 1) {
    if (NO_SPEED_MODELS[model]) fail(model + " has no speed control; leave speed unset.");
    finiteNumber(body.speed, "speed", SPEED_MIN, SPEED_MAX);
    if (out.voice_settings && present(out.voice_settings.speed) && out.voice_settings.speed !== body.speed) {
      fail("speed and metadata.voice_settings.speed differ; set only one.");
    }
    out.voice_settings = Object.assign({}, out.voice_settings || {}, { speed: body.speed });
  }
  if (present(metadata.language_code)) {
    const code = metadata.language_code;
    if (typeof code !== "string" || !/^[a-z]{2,3}$/.test(code)) fail("metadata.language_code must be an ISO 639-1 or 639-3 code such as en.");
    out.language_code = code;
  }
  if (present(metadata.seed)) out.seed = integer(metadata.seed, "metadata.seed", 0, 4294967295);
  if (present(metadata.previous_text)) out.previous_text = text(metadata.previous_text, "metadata.previous_text", limit);
  if (present(metadata.next_text)) out.next_text = text(metadata.next_text, "metadata.next_text", limit);
  if (present(metadata.apply_text_normalization)) {
    const n = metadata.apply_text_normalization;
    if (["auto", "on", "off"].indexOf(n) < 0) fail("metadata.apply_text_normalization must be auto, on or off.");
    out.apply_text_normalization = n;
  }
  if (present(metadata.apply_language_text_normalization)) {
    out.apply_language_text_normalization = bool(metadata.apply_language_text_normalization, "metadata.apply_language_text_normalization");
  }
  if (present(metadata.use_pvc_as_ivc)) out.use_pvc_as_ivc = bool(metadata.use_pvc_as_ivc, "metadata.use_pvc_as_ivc");
  if (present(metadata.audio_effects)) {
    if (!isObject(metadata.audio_effects)) fail("metadata.audio_effects must be an object.");
    out.audio_effects = metadata.audio_effects;
  }
  return {
    path: "/v1/text-to-speech/" + encodeURIComponent(voice) + querySuffix(format, config),
    body: out,
    format: format
  };
}

function rejectSpeed(body, kind) {
  if (present(body.speed) && body.speed !== 1) fail("speed is not supported for " + KINDS[kind].label.toLowerCase() + ".");
}

function buildMusic(body, model, metadata, config) {
  rejectSpeed(body, "music");
  text(body.input, "input", MUSIC_PROMPT_LIMIT);
  if (!present(metadata.music_length_ms)) {
    fail("metadata.music_length_ms is required: the song length in milliseconds (" + MUSIC_MIN_MS + " to " + MUSIC_MAX_MS + "), which is also what the request is billed for.");
  }
  const format = outputFormat(body, metadata, "music");
  const out = {
    prompt: body.input,
    model_id: model,
    music_length_ms: integer(metadata.music_length_ms, "metadata.music_length_ms", MUSIC_MIN_MS, MUSIC_MAX_MS)
  };
  if (present(metadata.force_instrumental)) out.force_instrumental = bool(metadata.force_instrumental, "metadata.force_instrumental");
  if (present(metadata.seed)) out.seed = integer(metadata.seed, "metadata.seed", 0, 2147483647);
  if (present(metadata.lyrics_text)) out.lyrics_text = text(metadata.lyrics_text, "metadata.lyrics_text", MUSIC_LYRICS_LIMIT);
  if (present(metadata.use_phonetic_names)) out.use_phonetic_names = bool(metadata.use_phonetic_names, "metadata.use_phonetic_names");
  if (present(metadata.sign_with_c2pa)) {
    out.sign_with_c2pa = bool(metadata.sign_with_c2pa, "metadata.sign_with_c2pa");
    if (out.sign_with_c2pa && format.indexOf("mp3_") !== 0) fail("metadata.sign_with_c2pa needs an mp3 output format.");
  }
  return { path: "/v1/music" + querySuffix(format, config), body: out, format: format };
}

function buildSoundEffect(body, model, metadata, config) {
  rejectSpeed(body, "sfx");
  if (!present(metadata.duration_seconds)) {
    fail("metadata.duration_seconds is required: the sound length in seconds (" + SFX_MIN_SECONDS + " to " + SFX_MAX_SECONDS + "), which is also what the request is billed for.");
  }
  const format = outputFormat(body, metadata, "sfx");
  const out = {
    text: body.input,
    model_id: model,
    duration_seconds: finiteNumber(metadata.duration_seconds, "metadata.duration_seconds", SFX_MIN_SECONDS, SFX_MAX_SECONDS)
  };
  if (present(metadata.loop)) out.loop = bool(metadata.loop, "metadata.loop");
  if (present(metadata.prompt_influence)) out.prompt_influence = finiteNumber(metadata.prompt_influence, "metadata.prompt_influence", 0, 1);
  return { path: "/v1/sound-generation" + querySuffix(format, config), body: out, format: format };
}

// The upstream request for one /v1/audio/speech body. Exported for tests.
export function buildUpstream(body, model, config) {
  if (!isObject(body)) fail("A JSON body is required.");
  if (typeof model !== "string" || model === "") fail("model is required.");
  checkCommon(body);
  const kind = modelKind(model);
  const metadata = readMetadata(body, kind, model);
  if (kind === "music") return buildMusic(body, model, metadata, config || {});
  if (kind === "sfx") return buildSoundEffect(body, model, metadata, config || {});
  return buildSpeech(body, model, metadata, config || {});
}

export function convertRequest(ctx, request) {
  if (ctx.path !== SPEECH_PATH) fail("This plugin only serves " + SPEECH_PATH + ".");
  if (!request || !isObject(request.body)) fail("A JSON body is required.");
  const model = request.model || request.body.model;
  const built = buildUpstream(request.body, model, ctx.config);
  return {
    path: built.path,
    method: "POST",
    body: built.body,
    stream: false,
    state: { model: model, kind: modelKind(model), format: built.format }
  };
}

const FORMAT_TYPES = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  wav: "audio/wav",
  pcm: "audio/pcm",
  ulaw: "audio/basic",
  alaw: "audio/basic"
};

export function contentTypeFor(format) {
  return FORMAT_TYPES[String(format || "").split("_")[0]] || "application/octet-stream";
}

function header(headers, name) {
  const want = name.toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === want) return headers[keys[i]];
  }
  return "";
}

function vendorMessage(raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { message: String(raw || "").slice(0, 512) || "empty response" };
  }
  const detail = parsed && parsed.detail !== undefined ? parsed.detail : parsed;
  if (typeof detail === "string") return { message: detail };
  if (Array.isArray(detail)) {
    const parts = detail.slice(0, 5).map(function (d) {
      const loc = Array.isArray(d && d.loc) ? d.loc.filter(function (x) { return x !== "body"; }).join(".") : "";
      return (loc ? loc + ": " : "") + String((d && (d.msg || d.message)) || "invalid value");
    });
    return { message: parts.join("; "), code: "invalid_request" };
  }
  if (isObject(detail)) {
    const code = typeof detail.status === "string" ? detail.status : (typeof detail.code === "string" ? detail.code : undefined);
    const message = typeof detail.message === "string" ? detail.message : JSON.stringify(detail).slice(0, 512);
    return code ? { message: message, code: code } : { message: message };
  }
  return { message: String(raw).slice(0, 512) };
}

export function convertResponse(ctx, response) {
  const state = ctx.state || {};
  const status = response.status;
  if (status < 200 || status >= 300) {
    const raw = response.body !== undefined ? response.body : "";
    const v = vendorMessage(raw);
    const error = { status: status >= 400 && status <= 599 ? status : 502, message: "ElevenLabs: " + v.message, type: "upstream_error" };
    if (v.code) error.code = v.code;
    return { error: error };
  }
  if (response.bodyBase64 === undefined || response.bodyBase64 === "") {
    const v = vendorMessage(response.body || "");
    return { error: { status: 502, message: "ElevenLabs returned no audio: " + v.message, type: "upstream_error" } };
  }
  const upstreamType = header(response.headers, "Content-Type");
  const type = upstreamType && upstreamType.indexOf("audio/") === 0 ? upstreamType : contentTypeFor(state.format);
  return { bodyBase64: response.bodyBase64, contentType: type };
}

// Requests are always sent with stream: false, so the host reads the audio
// whole; a stream only arrives if ElevenLabs answers with an event stream.
export function convertStreamEvent(ctx, input) {
  return { error: { status: 502, message: "ElevenLabs answered with an unexpected stream.", type: "upstream_error" } };
}
