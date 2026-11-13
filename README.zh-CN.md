---
locale: zh-CN
---

# ElevenLabs

[English](README.md) | **简体中文**

通过 OpenAI 兼容的 `POST /v1/audio/speech` 接口提供 ElevenLabs 文本转语音、音乐生成和音效生成。与 OpenAI 语音接口一样，响应就是音频文件本身。插件按模型选择 ElevenLabs 接口：

- 文本转语音：`eleven_v4`、`eleven_v3`、`eleven_multilingual_v2`、`eleven_flash_v2_5`、`eleven_flash_v2` 调用 `POST /v1/text-to-speech/{voice_id}`。
- 音乐：`music_v2_5`、`music_v2` 调用 `POST /v1/music`。
- 音效：`eleven_text_to_sound_v3` 调用 `POST /v1/sound-generation`。

需要 new-api v1.0.0-rc.50 或更高版本（provider 插件）。插件标识为 `byaiden_elevenlabs`。

## 渠道设置

1. 安装插件后，新建类型为「任务插件」（Task Plugin）的渠道并绑定本插件。
2. 密钥：ElevenLabs 控制台（Developers → API keys）中的 API 密钥，以 `xi-api-key` 请求头发送。请按需为密钥开启文本转语音、音乐和音效权限。
3. Base URL：`https://api.elevenlabs.io`（默认值）。数据驻留账号请改用对应地区地址，例如 `https://api.eu.residency.elevenlabs.io`、`https://api.in.residency.elevenlabs.io` 或 `https://api.sg.residency.elevenlabs.io`。
4. 模型：上面列出的任意模型。可以用模型映射对外发布其他名称，例如把 `tts-1` 映射到 `eleven_flash_v2_5`；插件会把映射后的名称发给 ElevenLabs。只有启用的渠道列出某个模型后，它才会出现在定价页面上。
5. 渠道配置：
   - 默认音色 ID：请求使用 OpenAI 音色名（`alloy`、`nova` 等）或未指定音色时使用的 ElevenLabs 音色，默认 `JBFqnCBsd6RMkjVDRZzb`。
   - 零保留模式：发送 `enable_logging=false`，ElevenLabs 不保留请求历史。ElevenLabs 仅允许企业账号使用。
6. 为每个模型设置价格（见「计费」）。new-api 的渠道测试按钮只测试对话类接口，对本渠道会失败；请用一次真实的语音请求检查渠道，并且不要让这些渠道参与自动渠道测试。

## 模型与接口

| 模型 | ElevenLabs 接口 | `input` | `metadata` 必填项 | 输出格式 |
| --- | --- | --- | --- | --- |
| `eleven_v4` | 文本转语音 | 文本，最多 10,000 字符 | 无 | mp3、opus、wav、pcm、ulaw、alaw |
| `eleven_v3` | 文本转语音 | 文本，最多 5,000 字符 | 无 | mp3、opus、wav、pcm、ulaw、alaw |
| `eleven_multilingual_v2` | 文本转语音 | 文本，最多 10,000 字符 | 无 | mp3、opus、wav、pcm、ulaw、alaw |
| `eleven_flash_v2_5` | 文本转语音 | 文本，最多 40,000 字符 | 无 | mp3、opus、wav、pcm、ulaw、alaw |
| `eleven_flash_v2` | 文本转语音 | 文本，最多 30,000 字符 | 无 | mp3、opus、wav、pcm、ulaw、alaw |
| `music_v2_5` | 音乐 | 提示词，最多 4,100 字符 | `music_length_ms`（3000 到 600000） | mp3、opus、pcm、ulaw、alaw |
| `music_v2` | 音乐 | 提示词，最多 4,100 字符 | `music_length_ms`（3000 到 600000） | mp3、opus、pcm、ulaw、alaw |
| `eleven_text_to_sound_v3` | 音效 | 声音描述 | `duration_seconds`（0.5 到 30） | mp3、opus、wav、pcm、ulaw、alaw |

请求字段：

- `model`、`input`：与 OpenAI 语音接口相同。
- `voice`：文本转语音使用的 ElevenLabs 音色 ID，可在 ElevenLabs 音色库或 ElevenLabs API 的 `GET /v1/voices` 中查到。OpenAI 音色名和空值使用渠道的默认音色。音乐和音效忽略该字段。
- `response_format`：`mp3`（默认，`mp3_44100_128`）、`opus`（`opus_48000_128`）、`wav`（`wav_44100`）或 `pcm`（`pcm_24000`，与 OpenAI 相同的 24 kHz 16 位格式）。也可以用 `metadata.output_format` 指定任意 ElevenLabs 输出格式，例如 `mp3_44100_192` 或 `pcm_44100`；部分格式需要更高的 ElevenLabs 套餐。
- `speed`：仅文本转语音，0.7 到 1.2，作为 `voice_settings.speed` 发送。`eleven_v4` 不支持语速调节。
- `metadata`：ElevenLabs 选项。new-api 只把 OpenAI 语音字段传给插件，其余选项都放在这里：
  - 文本转语音：`voice_id`、`voice_settings`（`stability`、`similarity_boost`、`style`、`speed`、`use_speaker_boost`、`clone_strength`）、`language_code`、`seed`、`previous_text`、`next_text`、`apply_text_normalization`、`apply_language_text_normalization`、`use_pvc_as_ivc`、`audio_effects`、`output_format`。
  - 音乐：`music_length_ms`（必填）、`force_instrumental`、`seed`、`lyrics_text`、`use_phonetic_names`、`sign_with_c2pa`（仅 mp3）、`output_format`。
  - 音效：`duration_seconds`（必填）、`loop`、`prompt_influence`（0 到 1）、`output_format`。

以下内容会被拒绝并返回错误：`instructions`（`eleven_v3` 和 `eleven_v4` 请在 `input` 中使用 `[whispers]` 等音频标签）、`stream_format: "sse"`、`aac` 和 `flac` 格式、未知的 `metadata` 字段，以及会访问渠道背后 ElevenLabs 账号资源或改变歌曲计价方式的选项：`previous_request_ids`、`next_request_ids`、`pronunciation_dictionary_locators`、`finetune_id`、`store_for_inpainting` 和 `composition_plan`。

## 计费

这些请求由 new-api 根据请求本身计费：文本转语音按 `input` 的字符数（记为输入 token，即计费表达式中的 `p`），音乐和音效按 `metadata` 中的时长；插件要求必须提供时长，并原样发给 ElevenLabs。请使用表达式计费模式和下面的表达式，它们按 ElevenLabs API 标价收费（v4、v3 和 Multilingual v2 每 1,000 字符 0.08 美元，Flash 每 1,000 字符 0.04 美元，音乐每分钟 0.15 美元，音效每分钟 0.12 美元）。把系数乘以你的加价倍数即可。

| 模型 | 表达式 |
| --- | --- |
| `eleven_v4`、`eleven_v3`、`eleven_multilingual_v2` | `tier("base", p * 80)` |
| `eleven_flash_v2_5`、`eleven_flash_v2` | `tier("base", p * 40)` |
| `music_v2_5`、`music_v2` | `tier("base", float(param("metadata.music_length_ms") ?? 0) * 2.5)` |
| `eleven_text_to_sound_v3` | `tier("base", float(param("metadata.duration_seconds") ?? 0) * 2000)` |

系数是每百万单位的美元价格：语音为字符，音乐为毫秒，音效为秒。例如 30 秒的歌曲计费 30000 × 2.5 / 1,000,000 = 0.075 美元，5 秒的音效计费 0.01 美元。`?? 0` 只是为了让表达式能够保存；缺少时长的请求在发往 ElevenLabs 之前就会被拒绝。

文本转语音也可以使用模型倍率：v4、v3 和 Multilingual v2 设为 40，Flash 设为 20，按字符收费结果相同，另外每次请求多计 1 个字符。

被拒绝的请求和 ElevenLabs 返回的错误不计费。ElevenLabs 没有幂等键：客户端对超时请求重试时会再次计费。

## 示例

```bash
curl https://your-gateway.example/v1/audio/speech \
  -H "Authorization: Bearer $NEWAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "music_v2_5", "input": "Warm lo-fi hip hop with soft rain and vinyl crackle", "voice": "alloy", "metadata": {"music_length_ms": 30000, "force_instrumental": true}}' \
  --output song.mp3
```

使用 OpenAI SDK 时，把 ElevenLabs 选项放进 `extra_body`：

```python
client.audio.speech.create(model="eleven_v3", voice="JBFqnCBsd6RMkjVDRZzb", input="[whispers] Hello there.",
                           extra_body={"metadata": {"voice_settings": {"stability": 0.5}, "language_code": "en"}})
```

## 限制

- 每个请求返回一个完整读取的音频文件；不支持流式输出（`stream_format: "sse"`）。长歌曲生成较慢，客户端超时请设为一分钟以上。
- 音乐仅支持提示词生成，不支持作曲方案（composition plan）、微调模型和局部重绘。
- `eleven_v4_turbo` 和 `eleven_v3_conversational` 是只通过 WebSocket 提供的实时模型，本插件不提供。已弃用的 `music_v1`、`eleven_text_to_sound_v2` 和 Turbo 模型未列出；在 ElevenLabs 下线之前，渠道列出它们时仍可透传。
- 对话生成（Text to Dialogue）、语音转文字、变声和配音不在本插件范围内。
