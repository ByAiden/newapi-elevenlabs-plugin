---
changelogVersion: 1
plugin: byaiden_elevenlabs
version: 1.0.0
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---

# Changelog

## [1.0.0]

### Added

- OpenAI-compatible speech endpoint `POST /v1/audio/speech` for ElevenLabs on a Task Plugin channel, answering with the audio bytes ElevenLabs returns.
- Text to speech with `eleven_v4`, `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5` and `eleven_flash_v2` through `/v1/text-to-speech/{voice_id}`, with ElevenLabs voice IDs, a channel default voice for OpenAI voice names, `speed`, and ElevenLabs options such as `voice_settings`, `language_code` and `seed` in `metadata`.
- Music with `music_v2_5` and `music_v2` through `/v1/music`, and sound effects with `eleven_text_to_sound_v3` through `/v1/sound-generation`, from the prompt in `input` and the length in `metadata.music_length_ms` or `metadata.duration_seconds`.
- Output formats from `response_format` (mp3, opus, wav, pcm) or any ElevenLabs `output_format` in `metadata`, and an optional zero retention mode per channel.
- Billing by new-api expressions on the input characters for speech and on the requested length for music and sound effects, with ready-made expressions at the ElevenLabs API list prices in the README.
- Validation with readable errors for missing lengths, out-of-range values, unsupported formats and options that would reach into the ElevenLabs account behind the channel; ElevenLabs errors keep their status and code and are not billed.
