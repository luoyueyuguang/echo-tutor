import { useEffect, useRef } from 'react'

export interface AvatarProps {
  speaking: boolean
  listening: boolean
  thinking: boolean
  emotion?: 'neutral' | 'encourage' | 'thinking'
  getAmplitude?: () => number
  compact?: boolean
}

/**
 * A 2D digital human driven by Live2D-style parameters:
 * mouth open/form, eye open, head angle, body sway, breathing.
 * The renderer is self-contained SVG so it works offline and with zero
 * per-minute cost. A Live2D Cubism renderer can replace this component
 * behind the same props.
 */
export function Avatar({ speaking, listening, thinking, emotion = 'neutral', getAmplitude, compact }: AvatarProps) {
  const propsRef = useRef({ speaking, listening, thinking, emotion, getAmplitude })
  propsRef.current = { speaking, listening, thinking, emotion, getAmplitude }

  const headRef = useRef<SVGGElement>(null)
  const bodyRef = useRef<SVGGElement>(null)
  const eyeLRef = useRef<SVGGElement>(null)
  const eyeRRef = useRef<SVGGElement>(null)
  const pupilLRef = useRef<SVGCircleElement>(null)
  const pupilRRef = useRef<SVGCircleElement>(null)
  const browLRef = useRef<SVGPathElement>(null)
  const browRRef = useRef<SVGPathElement>(null)
  const mouthGroupRef = useRef<SVGGElement>(null)
  const mouthRef = useRef<SVGEllipseElement>(null)
  const tongueRef = useRef<SVGEllipseElement>(null)
  const smileRef = useRef<SVGPathElement>(null)
  const blushRef = useRef<SVGGElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)

  useEffect(() => {
    let raf = 0
    let running = true
    let mouth = 0
    let blinkStart = -1000
    let nextBlink = 1800
    const start = performance.now()

    const frame = (now: number) => {
      if (!running) return
      const t = now - start
      const p = propsRef.current
      const amp = p.speaking ? Math.min(1, Math.max(0, p.getAmplitude?.() ?? 0)) : 0

      // Synthetic envelope for browser TTS, whose audio is not routable
      // through Web Audio and therefore cannot be measured directly.
      let target = amp
      if (p.speaking && amp === 0) {
        const carrier = 0.5 + 0.5 * Math.sin(t / 62 + Math.sin(t / 210) * 2)
        const flutter = 0.55 + 0.45 * Math.sin(t / 27 + 1.7)
        const pause = Math.sin(t / 2100) > 0.93 ? 0.15 : 1
        target = Math.max(0.05, carrier * flutter * pause)
      }
      mouth += (target - mouth) * (target > mouth ? 0.42 : 0.16)

      if (mouthGroupRef.current) {
        mouthGroupRef.current.style.opacity = String(Math.min(1, mouth * 7))
      }
      if (mouthRef.current) {
        mouthRef.current.setAttribute('ry', String(2 + mouth * 15))
        mouthRef.current.setAttribute('rx', String(14 + mouth * 4 + (p.emotion === 'encourage' ? 2 : 0)))
      }
      if (tongueRef.current) {
        tongueRef.current.setAttribute('ry', String(1 + mouth * 3))
      }
      if (smileRef.current) {
        smileRef.current.style.opacity = String(Math.max(0, 1 - mouth * 8))
        const curve = p.emotion === 'encourage' ? 9 : p.emotion === 'thinking' ? 2 : 5
        smileRef.current.setAttribute('d', `M 160 233 Q 180 ${233 + curve} 200 233`)
      }

      if (now > nextBlink) {
        blinkStart = now
        nextBlink = now + 2100 + Math.random() * 3800
      }
      const bt = now - blinkStart
      let blink = 1
      if (bt < 85) blink = 1 - bt / 85
      else if (bt < 190) blink = (bt - 85) / 105
      const eyeScale = listening ? blink * 1.04 : blink
      if (eyeLRef.current) eyeLRef.current.style.transform = `scaleY(${eyeScale})`
      if (eyeRRef.current) eyeRRef.current.style.transform = `scaleY(${eyeScale})`

      const look = p.thinking ? -1.6 : 0
      if (pupilLRef.current) pupilLRef.current.setAttribute('transform', `translate(${look} ${p.thinking ? -1.2 : 0})`)
      if (pupilRRef.current) pupilRRef.current.setAttribute('transform', `translate(${look} ${p.thinking ? -1.2 : 0})`)

      const browLift = p.thinking ? -2.4 : p.listening ? -1.6 : p.emotion === 'encourage' ? -1 : 0
      if (browLRef.current) browLRef.current.setAttribute('transform', `translate(0 ${browLift})`)
      if (browRRef.current) browRRef.current.setAttribute('transform', `translate(0 ${browLift})`)

      if (blushRef.current) {
        blushRef.current.style.opacity = String(p.emotion === 'encourage' ? 0.55 : p.listening ? 0.4 : 0.25)
      }

      const sway = Math.sin(t / 2600) * 1.3
      const nod = p.speaking ? Math.sin(t / 95) * 1.6 * Math.max(0.15, mouth) : Math.sin(t / 1800) * 0.5
      const lean = p.listening ? 2 : 0
      if (headRef.current) {
        headRef.current.setAttribute(
          'transform',
          `translate(${sway + (p.thinking ? 1.5 : 0)} ${nod + lean}) rotate(${sway * 0.7} 180 190)`,
        )
      }
      if (bodyRef.current) {
        bodyRef.current.setAttribute('transform', `translate(0 ${Math.sin(t / 1700) * 1.7})`)
      }
      if (ringRef.current) {
        const pulse = p.listening ? 0.5 + 0.5 * Math.sin(t / 420) : 0
        ringRef.current.style.opacity = String(p.listening ? 0.25 + pulse * 0.35 : 0)
        ringRef.current.setAttribute('r', String(132 + pulse * 8))
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      running = false
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className={`avatar ${compact ? 'avatar-compact' : ''}`}>
      <svg viewBox="0 0 360 440" role="img" aria-label="Aria, your English tutor">
        <defs>
          <radialGradient id="glow" cx="50%" cy="42%" r="52%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.04" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="skin" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#f8d9bd" />
            <stop offset="100%" stopColor="#e7b18c" />
          </linearGradient>
          <linearGradient id="hair" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#3a2b3f" />
            <stop offset="55%" stopColor="#2a1e2f" />
            <stop offset="100%" stopColor="#1d1624" />
          </linearGradient>
          <linearGradient id="sweater" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#2f6f6b" />
            <stop offset="100%" stopColor="#1c4b4a" />
          </linearGradient>
          <radialGradient id="blush">
            <stop offset="0%" stopColor="#ef8f8f" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ef8f8f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mic" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#39465a" />
            <stop offset="100%" stopColor="#222c3a" />
          </linearGradient>
        </defs>

        <circle cx="180" cy="205" r="160" fill="url(#glow)" />
        <circle ref={ringRef} cx="180" cy="205" r="132" fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0" />

        <ellipse cx="180" cy="418" rx="104" ry="12" fill="#000" opacity="0.28" />

        <g ref={bodyRef}>
          <path
            d="M 72 440 C 76 372 112 336 156 326 L 204 326 C 248 336 284 372 288 440 Z"
            fill="url(#sweater)"
          />
          <path d="M 156 326 C 164 350 196 350 204 326 L 214 334 C 204 366 156 366 146 334 Z" fill="#173e3d" />
          <path d="M 160 326 L 180 352 L 200 326" fill="none" stroke="#7fd8cf" strokeOpacity="0.25" strokeWidth="2" />
          <rect x="158" y="244" width="44" height="58" rx="22" fill="#e0a982" />
          <path d="M 156 300 C 166 312 194 312 204 300" fill="none" stroke="#cf9670" strokeWidth="2" opacity="0.6" />
        </g>

        <g ref={headRef}>
          <path
            d="M 100 198 C 92 108 130 66 180 66 C 230 66 268 108 260 198 C 260 246 268 286 258 316 C 246 340 220 322 218 286 L 142 286 C 140 322 114 340 102 316 C 92 286 100 246 100 198 Z"
            fill="url(#hair)"
          />
          <ellipse cx="110" cy="196" rx="9" ry="13" fill="#e7b18c" />
          <ellipse cx="250" cy="196" rx="9" ry="13" fill="#e7b18c" />
          <ellipse cx="180" cy="190" rx="71" ry="82" fill="url(#skin)" />
          <path d="M 118 160 C 126 104 150 84 180 84 C 210 84 238 104 246 160 C 232 138 214 128 202 126 C 194 149 168 157 148 149 C 138 158 128 164 118 160 Z" fill="url(#hair)" />
          <path d="M 110 165 C 100 204 102 240 114 262 C 120 232 118 198 124 176 Z" fill="url(#hair)" />
          <path d="M 250 165 C 260 204 258 240 246 262 C 240 232 242 198 236 176 Z" fill="url(#hair)" />

          <g ref={browLRef}>
            <path d="M 139 178 Q 154 170 169 176" stroke="#2a1e2f" strokeWidth="3.6" strokeLinecap="round" fill="none" />
          </g>
          <g ref={browRRef}>
            <path d="M 191 176 Q 206 170 221 178" stroke="#2a1e2f" strokeWidth="3.6" strokeLinecap="round" fill="none" />
          </g>

          <g ref={eyeLRef} className="avatar-eye">
            <ellipse cx="154" cy="197" rx="13" ry="10" fill="#fffaf4" />
            <circle cx="155" cy="198" r="7" fill="#6a7fa3" />
            <circle ref={pupilLRef} cx="155" cy="198" r="3.4" fill="#1a2029" />
            <circle cx="152.6" cy="195.4" r="1.9" fill="#fff" opacity="0.95" />
          </g>
          <g ref={eyeRRef} className="avatar-eye">
            <ellipse cx="206" cy="197" rx="13" ry="10" fill="#fffaf4" />
            <circle cx="205" cy="198" r="7" fill="#6a7fa3" />
            <circle ref={pupilRRef} cx="205" cy="198" r="3.4" fill="#1a2029" />
            <circle cx="202.6" cy="195.4" r="1.9" fill="#fff" opacity="0.95" />
          </g>

          <path d="M 180 200 Q 175 212 181 215" stroke="#cf9670" strokeWidth="2.2" strokeLinecap="round" fill="none" />

          <g ref={blushRef} opacity="0.3">
            <ellipse cx="136" cy="219" rx="14" ry="8" fill="url(#blush)" />
            <ellipse cx="224" cy="219" rx="14" ry="8" fill="url(#blush)" />
          </g>

          <path ref={smileRef} d="M 160 233 Q 180 238 200 233" stroke="#a34b4b" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <g ref={mouthGroupRef} opacity="0">
            <ellipse ref={mouthRef} cx="180" cy="236" rx="16" ry="2" fill="#5b2530" />
            <ellipse ref={tongueRef} cx="180" cy="241" rx="9" ry="1" fill="#c96b6b" />
          </g>

          <path d="M 112 150 C 120 92 150 76 180 76 C 210 76 240 92 248 150" stroke="url(#mic)" strokeWidth="8" fill="none" strokeLinecap="round" />
          <rect x="99" y="172" width="15" height="38" rx="7.5" fill="url(#mic)" />
          <rect x="103" y="178" width="4" height="12" rx="2" fill="var(--accent)" opacity="0.7" />
          <path d="M 107 204 C 112 226 128 240 146 244" stroke="url(#mic)" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="148" cy="244" r="4.5" fill="var(--accent)" opacity="0.9" />
        </g>
      </svg>
      <div className="avatar-caption">
        <span className={`status-dot ${speaking ? 'is-speaking' : listening ? 'is-listening' : thinking ? 'is-thinking' : ''}`} />
        <strong>Aria</strong>
        <span>{speaking ? '正在说' : listening ? '正在听' : thinking ? '思考中' : '在线'}</span>
      </div>
    </div>
  )
}
