---
locale: en
translations:
  zh-CN: README.zh-CN.md
---

# ElevenLabs

**English** | [简体中文](README.zh-CN.md)

Serves ElevenLabs text to speech, music and sound effects on the OpenAI-compatible `POST /v1/audio/speech` endpoint. The reply is the audio file itself, as with OpenAI speech. The plugin picks the ElevenLabs API from the model:

- Text to speech: `eleven_v4`, `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`, `eleven_flash_v2` call `POST /v1/text-to-speech/{voice_id}`.
- Music: `music_v2_5`, `music_v2` call `POST /v1/music`.
- Sound effects: `eleven_text_to_sound_v3` calls `POST /v1/sound-generation`.

Requires new-api v1.0.0-rc.50 or later (provider plugins). The plugin key is `byaiden_elevenlabs`.

## Channel setup

1. Install the plugin, then add a channel of type Task Plugin and bind it to this plugin.
2. Key: an ElevenLabs API key from the ElevenLabs dashboard (Developers, API keys). It is sent as the `xi-api-key` header. Give the key access to Text to Speech, Music and Sound Effects as needed.
3. Base URL: `https://api.elevenlabs.io` (the default). Data residency accounts use their regional address instead, such as `https://api.eu.residency.elevenlabs.io`, `https://api.in.residency.elevenlabs.io` or `https://api.sg.residency.elevenlabs.io`.
4. Models: any of the models listed above. Use model mapping to publish other names, such as `tts-1` for `eleven_flash_v2_5`; the plugin sends the mapped name to ElevenLabs. A model appears on the pricing pages only after an enabled channel lists it.
5. Channel settings:
   - Default voice ID: the ElevenLabs voice used when a request names an OpenAI voice (`alloy`, `nova` and the others) or no voice. The default is `JBFqnCBsd6RMkjVDRZzb`.
   - Zero retention mode: sends `enable_logging=false`, so ElevenLabs keeps no history of the requests. ElevenLabs allows it for enterprise accounts only.
6. Set a price for each model (see Billing). The channel test button of new-api only tests chat-style endpoints and fails for this channel; check the channel with a real speech request instead, and leave these channels out of automatic channel tests.

## Models and endpoints

| Model | ElevenLabs API | `input` | Required in `metadata` | Output formats |
| --- | --- | --- | --- | --- |
| `eleven_v4` | Text to speech | Text, up to 10,000 characters | none | mp3, opus, wav, pcm, ulaw, alaw |
| `eleven_v3` | Text to speech | Text, up to 5,000 characters | none | mp3, opus, wav, pcm, ulaw, alaw |
| `eleven_multilingual_v2` | Text to speech | Text, up to 10,000 characters | none | mp3, opus, wav, pcm, ulaw, alaw |
| `eleven_flash_v2_5` | Text to speech | Text, up to 40,000 characters | none | mp3, opus, wav, pcm, ulaw, alaw |
| `eleven_flash_v2` | Text to speech | Text, up to 30,000 characters | none | mp3, opus, wav, pcm, ulaw, alaw |
| `music_v2_5` | Music | Prompt, up to 4,100 characters | `music_length_ms` (3000 to 600000) | mp3, opus, pcm, ulaw, alaw |
| `music_v2` | Music | Prompt, up to 4,100 characters | `music_length_ms` (3000 to 600000) | mp3, opus, pcm, ulaw, alaw |
| `eleven_text_to_sound_v3` | Sound effects | Description of the sound | `duration_seconds` (0.5 to 30) | mp3, opus, wav, pcm, ulaw, alaw |

Request fields:

- `model`, `input`: as in OpenAI speech.
- `voice`: an ElevenLabs voice ID for text to speech, from the ElevenLabs voice library or `GET /v1/voices` on the ElevenLabs API. OpenAI voice names and an empty voice use the channel's default voice. Music and sound effects ignore it.
- `response_format`: `mp3` (default, `mp3_44100_128`), `opus` (`opus_48000_128`), `wav` (`wav_44100`) or `pcm` (`pcm_24000`, the same 24 kHz 16-bit format as OpenAI). `metadata.output_format` takes any ElevenLabs output format instead, such as `mp3_44100_192` or `pcm_44100`; some formats need a higher ElevenLabs plan.
- `speed`: text to speech only, 0.7 to 1.2, sent as `voice_settings.speed`. `eleven_v4` has no speed control.
- `metadata`: the ElevenLabs options. new-api passes only the OpenAI speech fields to the plugin, so every other option goes here:
  - Text to speech: `voice_id`, `voice_settings` (`stability`, `similarity_boost`, `style`, `speed`, `use_speaker_boost`, `clone_strength`), `language_code`, `seed`, `previous_text`, `next_text`, `apply_text_normalization`, `apply_language_text_normalization`, `use_pvc_as_ivc`, `audio_effects`, `output_format`.
  - Music: `music_length_ms` (required), `force_instrumental`, `seed`, `lyrics_text`, `use_phonetic_names`, `sign_with_c2pa` (mp3 only), `output_format`.
  - Sound effects: `duration_seconds` (required), `loop`, `prompt_influence` (0 to 1), `output_format`.

Rejected with an error: `instructions` (use audio tags such as `[whispers]` in `input` with `eleven_v3` and `eleven_v4`), `stream_format: "sse"`, the formats `aac` and `flac`, unknown `metadata` keys, and options that reach into the ElevenLabs account behind the channel or change how a song is priced: `previous_request_ids`, `next_request_ids`, `pronunciation_dictionary_locators`, `finetune_id`, `store_for_inpainting` and `composition_plan`.

## Billing

new-api bills these requests itself, from the request: text to speech by the number of characters in `input` (counted as prompt tokens, so `p` in a billing expression), music and sound effects by the length in `metadata`, which the plugin requires and sends to ElevenLabs unchanged. Use the expression billing mode with these expressions; they charge the ElevenLabs API list prices (USD 0.08 per 1,000 characters for v4, v3 and Multilingual v2, USD 0.04 per 1,000 characters for Flash, USD 0.15 per minute of music, USD 0.12 per minute of sound effects). Multiply the factor by your margin.

| Model | Expression |
| --- | --- |
| `eleven_v4`, `eleven_v3`, `eleven_multilingual_v2` | `tier("base", p * 80)` |
| `eleven_flash_v2_5`, `eleven_flash_v2` | `tier("base", p * 40)` |
| `music_v2_5`, `music_v2` | `tier("base", float(param("metadata.music_length_ms") ?? 0) * 2.5)` |
| `eleven_text_to_sound_v3` | `tier("base", float(param("metadata.duration_seconds") ?? 0) * 2000)` |

The factor is the price in USD per million units: characters for speech, milliseconds of music, seconds of sound. For example a 30-second song bills 30000 x 2.5 / 1,000,000 = USD 0.075, and a 5-second sound bills USD 0.01. The `?? 0` only keeps the expression valid when it is saved; requests without the length are rejected before they reach ElevenLabs.

For text to speech, a model ratio works too: ratio 40 for v4, v3 and Multilingual v2 and ratio 20 for Flash charge the same per character, plus one character per request.

Rejected requests and ElevenLabs errors are not billed. ElevenLabs has no idempotency key: a client that retries a request that timed out is charged again.

## Example

```bash
curl https://your-gateway.example/v1/audio/speech \
  -H "Authorization: Bearer $NEWAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "music_v2_5", "input": "Warm lo-fi hip hop with soft rain and vinyl crackle", "voice": "alloy", "metadata": {"music_length_ms": 30000, "force_instrumental": true}}' \
  --output song.mp3
```

With the OpenAI SDK, put the ElevenLabs options in `extra_body`:

```python
client.audio.speech.create(model="eleven_v3", voice="JBFqnCBsd6RMkjVDRZzb", input="[whispers] Hello there.",
                           extra_body={"metadata": {"voice_settings": {"stability": 0.5}, "language_code": "en"}})
```

## Limits

- One request returns one audio file, read whole; streaming (`stream_format: "sse"`) is not supported. Long songs take a while: keep the client timeout above a minute.
- Music is limited to prompts; composition plans, finetunes and inpainting are not available.
- `eleven_v4_turbo` and `eleven_v3_conversational` are realtime models offered over WebSockets only and are not served. The deprecated `music_v1`, `eleven_text_to_sound_v2` and Turbo models are not listed; they still pass through if a channel lists them, until ElevenLabs removes them.
- Text to dialogue, speech to text, voice changer and dubbing are not part of this plugin.
