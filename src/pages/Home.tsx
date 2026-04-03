import { useEffect, useRef, useState } from 'react'
import styles from './Home.module.css'

interface HomeProps {
  onStart: () => void
}

const PREVIEW_CHARS = ['A', 'B', 'f', 'g', 'R', '&', '3', 'Q', 'a', 'W', 'e', 'k']

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
    title: 'Glyph grid',
    desc: 'Every character in one view. Upload SVGs per slot — letters, numbers, punctuation, and extended sets.'
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 9h12M9 3v12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
    title: 'Per-glyph editor',
    desc: 'Scale, offset, adjust baseline and spacing. Alignment guides built in.'
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 14L9 4l5 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6 11h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Live preview',
    desc: '"The quick brown fox…" renders in real time using your actual glyphs as you build.'
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2v10M5 8l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3 14h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Export TTF & OTF',
    desc: 'Full OpenType output — proper metrics, cmap, correct winding. Runs entirely in your browser.'
  },
]

export default function Home({ onStart }: HomeProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={styles.root}>
      {/* Nav */}
      <nav className={`${styles.nav} ${mounted ? styles.navVisible : ''}`}>
        <div className={styles.navInner}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>F</span>
            <span className={styles.logoText}>Fontly</span>
          </div>
          <div className={styles.navRight}>
            <a href="https://github.com" className={styles.navLink} target="_blank" rel="noreferrer">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M7.5 1C3.91 1 1 3.91 1 7.5c0 2.87 1.86 5.3 4.44 6.16.32.06.44-.14.44-.3v-1.05c-1.8.39-2.18-.87-2.18-.87-.3-.75-.72-.95-.72-.95-.59-.4.04-.4.04-.4.65.05 1 .67 1 .67.58 1 1.52.71 1.9.54.06-.42.23-.71.41-.87-1.44-.16-2.95-.72-2.95-3.2 0-.71.25-1.29.67-1.74-.07-.16-.29-.82.06-1.72 0 0 .55-.17 1.8.67.52-.14 1.08-.21 1.63-.21.55 0 1.11.07 1.63.21 1.25-.84 1.8-.67 1.8-.67.35.9.13 1.56.06 1.72.42.45.67 1.03.67 1.74 0 2.49-1.52 3.04-2.96 3.2.23.2.44.59.44 1.19v1.76c0 .17.12.36.44.3A6.505 6.505 0 0 0 14 7.5C14 3.91 11.09 1 7.5 1Z" fill="currentColor"/>
              </svg>
              GitHub
            </a>
            <span className={styles.badge}>Open source</span>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className={styles.main} ref={heroRef}>
        <div className={`${styles.heroContent} ${mounted ? styles.heroVisible : ''}`}>

          {/* Floating glyph grid background */}
          <div className={styles.glyphBg} aria-hidden>
            {PREVIEW_CHARS.map((ch, i) => (
              <span
                key={i}
                className={styles.glyphFloat}
                style={{ animationDelay: `${i * 0.18}s` }}
              >
                {ch}
              </span>
            ))}
          </div>

          {/* Badge */}
          <div className={styles.heroBadge}>
            <span className={styles.dot} />
            Browser-native · No installs · No server
          </div>

          {/* Headline */}
          <h1 className={styles.headline}>
            Turn your SVGs<br />
            <em>into real fonts.</em>
          </h1>

          <p className={styles.subline}>
            Upload your hand-crafted SVG glyphs, set your metrics,<br />
            preview in real time, and export professional TTF & OTF files —<br />
            entirely in the browser.
          </p>

          {/* CTA */}
          <div className={styles.ctaRow}>
            <button className={styles.ctaPrimary} onClick={onStart}>
              Start building your font
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <span className={styles.ctaNote}>Free & open source</span>
          </div>
        </div>

        {/* Font preview card */}
        <div className={`${styles.previewCard} ${mounted ? styles.previewVisible : ''}`}>
          <div className={styles.previewHeader}>
            <div className={styles.previewDots}>
              <span /><span /><span />
            </div>
            <span className={styles.previewLabel}>Live preview</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewSentence}>
              The quick brown fox<br />jumps over the lazy dog.
            </div>
            <div className={styles.previewMeta}>
              <div className={styles.previewMetaItem}>
                <span className={styles.metaLabel}>Em size</span>
                <span className={styles.metaVal}>1000</span>
              </div>
              <div className={styles.previewMetaItem}>
                <span className={styles.metaLabel}>Ascender</span>
                <span className={styles.metaVal}>800</span>
              </div>
              <div className={styles.previewMetaItem}>
                <span className={styles.metaLabel}>Glyphs</span>
                <span className={styles.metaVal}>0 / 95</span>
              </div>
            </div>
            {/* Mini glyph grid sample */}
            <div className={styles.miniGrid}>
              {['A','B','C','a','b','c','0','1','2','!','?','.'].map((ch) => (
                <div key={ch} className={styles.miniCell}>
                  <span>{ch}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Features strip */}
      <section className={`${styles.features} ${mounted ? styles.featuresVisible : ''}`}>
        {FEATURES.map((f, i) => (
          <div
            key={i}
            className={`${styles.featureCard} ${hovered === i ? styles.featureCardHovered : ''}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ animationDelay: `${0.5 + i * 0.08}s` }}
          >
            <div className={styles.featureIcon}>{f.icon}</div>
            <div>
              <div className={styles.featureTitle}>{f.title}</div>
              <div className={styles.featureDesc}>{f.desc}</div>
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span>Fontly — SVG to Font, in your browser</span>
        <span className={styles.footerSep}>·</span>
        <span>MIT License</span>
      </footer>
    </div>
  )
}
