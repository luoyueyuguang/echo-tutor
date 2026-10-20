import { useEffect, useRef, useState } from 'react'
import type { AppSettings, Cefr, Exam, SettingsInput } from '../shared/types'
import { api } from '../api'
import { SpeechPlayer, useVoices } from '../lib/speech'
import { voiceSummary } from '../lib/voice'
import { EXAM_LABEL } from '../lib/format'
import { Pill, Spinner, type ToastKind } from './ui'

interface SettingsProps {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
  notify: (message: string, kind?: ToastKind) => void
}

export function SettingsView({ settings, onSaved, notify }: SettingsProps) {
  const [form, setForm] = useState({
    llmBaseUrl: settings.llmBaseUrl,
    llmModel: settings.llmModel,
    llmApiKey: '',
    asrProvider: settings.asrProvider,
    ttsProvider: settings.ttsProvider,
    accent: settings.accent,
    rate: settings.rate,
    pitch: settings.pitch,
    browserVoiceURI: settings.browserVoiceURI,
    ttsVoice: settings.ttsVoice,
    ttsBaseUrl: settings.ttsBaseUrl,
    ttsModel: settings.ttsModel,
    ttsApiKey: '',
    exam: settings.exam,
    dailyGoalMin: settings.dailyGoalMin,
    studentLevel: settings.studentLevel,
  })
  const [keyTouched, setKeyTouched] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [ttsKeyTouched, setTtsKeyTouched] = useState(false)
  const [showTtsKey, setShowTtsKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const previewRef = useRef<SpeechPlayer | null>(null)
  const { voices, loaded: voicesLoaded } = useVoices()
  const browserVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'))
  const effectiveVoice = voiceSummary(voices, form.accent, form.browserVoiceURI, form.ttsProvider, form.ttsVoice)

  useEffect(() => () => previewRef.current?.cancel(), [])

  async function previewVoice() {
    if (form.ttsProvider === 'openai') {
      if (!form.ttsApiKey.trim() && !settings.ttsConfigured) {
        notify('请先填写 TTS API Key，或复用模型配置。', 'info')
        return
      }
      const saved = await save(false)
      if (!saved) return
    }
    previewRef.current?.cancel()
    const player = new SpeechPlayer(form.ttsProvider)
    previewRef.current = player
    player.onError = (message) => notify(message, 'error')
    await player.speak("Good morning. Let's talk about work and study. Do you work or are you a student?", {
      lang: form.accent,
      rate: Number(form.rate),
      pitch: Number(form.pitch),
      voiceURI: form.browserVoiceURI,
      voice: form.ttsVoice,
      instructions:
        'Speak like a neutral British IELTS examiner: clear, measured and neutral. Do not sound cheerful or exaggerated.',
    })
  }

  function applyIeltsPreset() {
    const candidate =
      browserVoices.find(
        (voice) => voice.lang.toLowerCase() === 'en-gb' && /sonia|ryan|libby|maisie|thomas/i.test(voice.name),
      ) ?? browserVoices.find((voice) => voice.lang.toLowerCase() === 'en-gb')
    if (!candidate) {
      notify('当前浏览器没有英音语音。请用 Edge，或配置服务端 TTS。', 'error')
      return
    }
    setForm((prev) => ({
      ...prev,
      ttsProvider: 'browser',
      accent: 'en-GB',
      browserVoiceURI: candidate.voiceURI,
      rate: 1.1,
      pitch: 1,
    }))
    notify(`已填入 ${candidate.name}，语速 1.1x；点“保存设置”生效。`, 'info')
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save(announce = true): Promise<boolean> {
    setSaving(true)
    try {
      const payload: SettingsInput = {
        llmBaseUrl: form.llmBaseUrl.trim(),
        llmModel: form.llmModel.trim(),
        asrProvider: form.asrProvider,
        ttsProvider: form.ttsProvider,
        accent: form.accent,
        rate: Number(form.rate),
        pitch: Number(form.pitch),
        browserVoiceURI: form.browserVoiceURI,
        ttsVoice: form.ttsVoice,
        ttsBaseUrl: form.ttsBaseUrl.trim(),
        ttsModel: form.ttsModel.trim() || 'gpt-4o-mini-tts',
        exam: form.exam,
        dailyGoalMin: Number(form.dailyGoalMin),
        studentLevel: form.studentLevel,
      }
      if (keyTouched) payload.llmApiKey = form.llmApiKey.trim()
      if (ttsKeyTouched) payload.ttsApiKey = form.ttsApiKey.trim()
      const updated = await api.saveSettings(payload)
      onSaved(updated)
      setForm((prev) => ({ ...prev, llmApiKey: '', ttsApiKey: '' }))
      setKeyTouched(false)
      setTtsKeyTouched(false)
      if (announce) notify('设置已保存。', 'success')
      return true
    } catch (err) {
      notify((err as Error).message, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    const saved = await save(false)
    if (!saved) {
      setTesting(false)
      return
    }
    try {
      const result = await api.testLlm()
      notify(`连接成功：${result.reply || 'OK'}`, 'success')
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-view">
      <div className="view-head">
        <div>
          <h2>设置</h2>
          <p className="muted">所有配置保存在本机 SQLite。API Key 只在请求模型服务时使用。</p>
        </div>
        <Pill tone={settings.llmApiKeySet ? 'success' : 'warn'}>{settings.llmApiKeySet ? '模型已配置' : '未配置模型'}</Pill>
      </div>

      <section className="settings-card">
        <h3>模型（OpenAI 兼容接口）</h3>
        <div className="form-grid">
          <label>
            <span>Base URL</span>
            <input
              value={form.llmBaseUrl}
              onChange={(event) => update('llmBaseUrl', event.target.value)}
              placeholder="https://api.openai.com/v1"
              list="base-url-presets"
            />
            <datalist id="base-url-presets">
              <option value="https://api.openai.com/v1" />
              <option value="https://api.deepseek.com/v1" />
              <option value="https://api.moonshot.cn/v1" />
              <option value="http://localhost:11434/v1" />
            </datalist>
          </label>
          <label>
            <span>模型名</span>
            <input
              value={form.llmModel}
              onChange={(event) => update('llmModel', event.target.value)}
              placeholder="gpt-4o-mini"
              list="model-presets"
            />
            <datalist id="model-presets">
              <option value="gpt-4o-mini" />
              <option value="gpt-4.1-mini" />
              <option value="deepseek-chat" />
              <option value="qwen-plus" />
              <option value="llama3.1" />
            </datalist>
          </label>
          <label className="span-2">
            <span>API Key {settings.llmApiKeySet ? '（已保存，留空则不修改）' : ''}</span>
            <div className="input-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.llmApiKey}
                onChange={(event) => {
                  setKeyTouched(true)
                  update('llmApiKey', event.target.value)
                }}
                placeholder={settings.llmApiKeySet ? '••••••••（留空保持不变）' : 'sk-…'}
                autoComplete="off"
              />
              <button className="btn tiny ghost" onClick={() => setShowKey((value) => !value)}>
                {showKey ? '隐藏' : '显示'}
              </button>
              <button
                className="btn tiny ghost"
                onClick={() => {
                  setKeyTouched(true)
                  update('llmApiKey', '')
                }}
              >
                清除
              </button>
            </div>
          </label>
        </div>
        <p className="muted tiny">
          任何兼容 <code>/chat/completions</code> 的服务都可以。Ollama 可填 <code>http://localhost:11434/v1</code>，Key 随便填一个非空值。
          未配置时，对话与评分不可用；写作仍会给出本地粗估。
        </p>
        <div className="settings-actions">
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner label="保存中…" /> : '保存设置'}
          </button>
          <button className="btn ghost" onClick={() => void test()} disabled={testing || saving}>
            {testing ? <Spinner label="测试中…" /> : '测试连接'}
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h3>学习目标</h3>
        <div className="form-grid">
          <label>
            <span>主攻考试</span>
            <select value={form.exam} onChange={(event) => update('exam', event.target.value as Exam)}>
              {(Object.keys(EXAM_LABEL) as Exam[]).map((exam) => (
                <option key={exam} value={exam}>
                  {EXAM_LABEL[exam]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>当前水平</span>
            <select value={form.studentLevel} onChange={(event) => update('studentLevel', event.target.value as Cefr)}>
              <option value="A2">A2 · 基础</option>
              <option value="B1">B1 · 中级</option>
              <option value="B2">B2 · 中高级</option>
              <option value="C1">C1 · 高级</option>
            </select>
          </label>
          <label>
            <span>每日目标（分钟）</span>
            <input
              type="number"
              min={5}
              max={240}
              value={form.dailyGoalMin}
              onChange={(event) => update('dailyGoalMin', Number(event.target.value))}
            />
          </label>
          <label>
            <span>口语口音</span>
            <select value={form.accent} onChange={(event) => update('accent', event.target.value as 'en-GB' | 'en-US')}>
              <option value="en-GB">英音（雅思）</option>
              <option value="en-US">美音（托福）</option>
            </select>
          </label>
          <label>
            <span>语速</span>
            <input
              type="range"
              min={0.6}
              max={1.5}
              step={0.1}
              value={form.rate}
              onChange={(event) => update('rate', Number(event.target.value))}
            />
            <small className="muted">{form.rate.toFixed(1)}x</small>
          </label>
        </div>
      </section>

      <section className="settings-card">
        <h3>语音</h3>
        <div className="form-grid">
          <label>
            <span>语音识别</span>
            <select
              value={form.asrProvider}
              onChange={(event) => update('asrProvider', event.target.value as 'browser' | 'whisper')}
            >
              <option value="browser">浏览器识别（免费，Chrome / Edge）</option>
              <option value="whisper">服务端 Whisper（需要模型 Key）</option>
            </select>
          </label>
          <label>
            <span>语音合成</span>
            <select value={form.ttsProvider} onChange={(event) => update('ttsProvider', event.target.value as 'browser' | 'openai')}>
              <option value="browser">浏览器朗读（免费）</option>
              <option value="openai">服务端 TTS（需要模型 Key）</option>
            </select>
          </label>
          {form.ttsProvider === 'browser' ? (
            <label className="span-2">
              <span>实际发音人</span>
              <select
                value={form.browserVoiceURI}
                onChange={(event) => update('browserVoiceURI', event.target.value)}
                disabled={!voicesLoaded || !browserVoices.length}
              >
                <option value="">自动（优先 {form.accent === 'en-GB' ? '英音' : '美音'}自然语音）</option>
                {browserVoices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <div className="tts-config span-2">
                <p className="muted tiny">独立 TTS 配置（留空则复用上方模型配置）</p>
                <div className="form-grid">
                  <label>
                    <span>TTS Base URL</span>
                    <input
                      value={form.ttsBaseUrl}
                      onChange={(event) => update('ttsBaseUrl', event.target.value)}
                      placeholder={settings.llmBaseUrl || 'https://api.openai.com/v1'}
                    />
                  </label>
                  <label>
                    <span>TTS 模型</span>
                    <input
                      value={form.ttsModel}
                      onChange={(event) => update('ttsModel', event.target.value)}
                      list="tts-model-presets"
                      placeholder="gpt-4o-mini-tts"
                    />
                    <datalist id="tts-model-presets">
                      <option value="gpt-4o-mini-tts" />
                      <option value="tts-1" />
                      <option value="tts-1-hd" />
                    </datalist>
                  </label>
                  <label className="span-2">
                    <span>
                      TTS API Key {settings.ttsApiKeySet ? '（已保存，留空不修改）' : '（留空复用模型 Key）'}
                    </span>
                    <div className="input-row">
                      <input
                        type={showTtsKey ? 'text' : 'password'}
                        value={form.ttsApiKey}
                        onChange={(event) => {
                          setTtsKeyTouched(true)
                          update('ttsApiKey', event.target.value)
                        }}
                        placeholder={settings.ttsApiKeySet ? '••••••••（留空保持不变）' : 'sk-…'}
                        autoComplete="off"
                      />
                      <button className="btn tiny ghost" onClick={() => setShowTtsKey((value) => !value)}>
                        {showTtsKey ? '隐藏' : '显示'}
                      </button>
                      <button
                        className="btn tiny ghost"
                        onClick={() => {
                          setTtsKeyTouched(true)
                          update('ttsApiKey', '')
                        }}
                      >
                        清除
                      </button>
                    </div>
                  </label>
                </div>
                <p className="muted tiny">
                  只支持 OpenAI 兼容的 <code>POST /audio/speech</code>。DeepSeek / Moonshot / Ollama 通常只有聊天接口，
                  需要单独填一个支持 TTS 的服务。
                </p>
              </div>
              <label className="span-2">
                <span>服务端语音名</span>
                <input
                  value={form.ttsVoice}
                  onChange={(event) => update('ttsVoice', event.target.value)}
                  list="tts-voice-presets"
                  placeholder="fable"
                />
                <datalist id="tts-voice-presets">
                  <option value="fable">Fable · 英式</option>
                  <option value="alloy">Alloy · 中性</option>
                  <option value="echo" />
                  <option value="onyx" />
                  <option value="nova" />
                  <option value="shimmer" />
                </datalist>
              </label>
            </>
          )}
          <label>
            <span>音高</span>
            <input
              type="range"
              min={0.8}
              max={1.2}
              step={0.05}
              value={form.pitch}
              onChange={(event) => update('pitch', Number(event.target.value))}
            />
            <small className="muted">{Number(form.pitch).toFixed(2)}</small>
          </label>
        </div>
        <div className="settings-actions">
          <button className="btn ghost" onClick={() => void previewVoice()}>
            试听当前声音
          </button>
          <button className="btn ghost" onClick={applyIeltsPreset}>
            雅思听力音色（1.1x）
          </button>
          {form.ttsProvider === 'browser' && voicesLoaded ? (
            <span className="muted small">
              当前：{effectiveVoice.name}
              {effectiveVoice.lang ? ` · ${effectiveVoice.lang}` : ''}
            </span>
          ) : null}
        </div>
        {voicesLoaded && effectiveVoice.warning ? <p className="voice-warning">{effectiveVoice.warning}</p> : null}
        <p className="muted tiny">
          浏览器语音质量由系统和浏览器决定。Edge 的 “Microsoft … Natural” 语音通常最接近真人；Linux 上的 Chrome 可能只有机械音，
          这时请改用服务端 TTS。服务端 TTS 走 OpenAI 兼容的 <code>/audio/speech</code>，<code>fable</code> 通常是英式口音。
        </p>
        <p className="muted tiny">
          浏览器识别依赖 Chrome / Edge 的语音服务，音频会发送给浏览器厂商；Whisper 模式会把录音发送到你配置的模型服务。
          浏览器不支持语音时，所有练习仍可用文字完成。
        </p>
      </section>

      <section className="settings-card">
        <h3>关于数字人</h3>
        <p className="muted small">
          当前数字人由内置的 2D 参数化骨骼渲染，按 Live2D 参数模型驱动口型、眨眼与头部姿态，离线可用且没有按分钟费用。
          若要换成正式 Live2D 模型，需要自行取得 Cubism SDK 与模型授权，并实现同参数的渲染适配层。
        </p>
        <p className="muted small">
          口语评分基于转写文本，不能替代真人考官的发音评分；界面中的 band 均为练习估算。
        </p>
      </section>
    </div>
  )
}
