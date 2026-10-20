export interface VoiceLike {
  name: string
  lang: string
  voiceURI: string
  localService?: boolean
  default?: boolean
}

const NATURAL = /natural|google|microsoft|premium|enhanced|neural/i

/**
 * Pick a browser voice. An explicit URI always wins; otherwise prefer a
 * natural-sounding voice in the requested accent, then any voice in that
 * accent, then another English voice.
 */
export function pickVoice<T extends VoiceLike>(voices: T[], accent: string, voiceURI: string): T | undefined {
  if (!voices.length) return undefined
  if (voiceURI) {
    const chosen = voices.find((voice) => voice.voiceURI === voiceURI)
    if (chosen) return chosen
  }
  const wanted = accent.toLowerCase()
  const exact = voices.filter((voice) => voice.lang.toLowerCase() === wanted)
  const natural = exact.find((voice) => NATURAL.test(voice.name))
  if (natural) return natural
  if (exact.length) return exact[0]

  const language = wanted.slice(0, 2)
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(language))
  return sameLanguage.find((voice) => NATURAL.test(voice.name)) ?? sameLanguage[0]
}

export interface VoiceSummary<T extends VoiceLike = VoiceLike> {
  voice?: T
  name: string
  lang: string
  warning: string
}

export function voiceSummary<T extends VoiceLike>(
  voices: T[],
  accent: string,
  voiceURI: string,
  provider: 'browser' | 'openai',
  serverVoice: string,
): VoiceSummary<T> {
  if (provider === 'openai') {
    return { name: serverVoice || 'fable', lang: 'server', warning: '' }
  }
  const voice = pickVoice(voices, accent, voiceURI)
  if (!voice) {
    return {
      name: '未检测到可用语音',
      lang: '',
      warning: '当前浏览器没有可用的英文语音。请切换服务端 TTS，或在系统中安装英音语音。',
    }
  }
  const matched = voice.lang.toLowerCase() === accent.toLowerCase()
  const accentName = accent === 'en-GB' ? '英音' : '美音'
  return {
    voice,
    name: voice.name,
    lang: voice.lang,
    warning: matched ? '' : `没有找到${accentName}语音，当前实际使用 ${voice.lang}。可在设置中更换声音。`,
  }
}
