---
changelogVersion: 1
plugin: byaiden_elevenlabs
version: 1.0.0
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 在任务插件渠道上为 ElevenLabs 提供 OpenAI 兼容的语音接口 `POST /v1/audio/speech`，直接返回 ElevenLabs 生成的音频。
- 通过 `/v1/text-to-speech/{voice_id}` 支持 `eleven_v4`、`eleven_v3`、`eleven_multilingual_v2`、`eleven_flash_v2_5` 和 `eleven_flash_v2` 文本转语音，支持 ElevenLabs 音色 ID、OpenAI 音色名对应的渠道默认音色、`speed`，以及放在 `metadata` 中的 `voice_settings`、`language_code`、`seed` 等 ElevenLabs 选项。
- 通过 `/v1/music` 支持 `music_v2_5` 和 `music_v2` 音乐生成，通过 `/v1/sound-generation` 支持 `eleven_text_to_sound_v3` 音效生成，提示词放在 `input`，时长放在 `metadata.music_length_ms` 或 `metadata.duration_seconds`。
- 输出格式可由 `response_format`（mp3、opus、wav、pcm）或 `metadata` 中任意 ElevenLabs `output_format` 指定；每个渠道可选开启零保留模式。
- 使用 new-api 表达式计费：语音按输入字符数，音乐和音效按请求时长；README 提供按 ElevenLabs API 标价编写的现成表达式。
- 对缺少时长、取值越界、不支持的格式以及会访问渠道背后 ElevenLabs 账号资源的选项返回清晰的错误；ElevenLabs 返回的错误保留原状态码和错误码，且不计费。
