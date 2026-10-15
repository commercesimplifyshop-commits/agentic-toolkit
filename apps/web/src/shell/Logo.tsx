/**
 * The Agentic Toolkit mark ("Nós"): an agent (the orange circle) at the center of three modules
 * (the squares), linking the pieces of the store without becoming one of them.
 */
export const BRAND_ORANGE = '#F26B21'

export function LogoMark({ size = 32, color = 'currentColor', accent = BRAND_ORANGE, title }: { size?: number; color?: string; accent?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g stroke={color} fill="none" strokeWidth={4} strokeLinecap="round">
        <path d="M32 37 L32 15" />
        <path d="M32 37 L51.05 48" />
        <path d="M32 37 L12.95 48" />
      </g>
      <rect x="25" y="8.5" width="14" height="14" rx="3.5" fill={color} />
      <rect x="44" y="41" width="14" height="14" rx="3.5" fill={color} />
      <rect x="6" y="41" width="14" height="14" rx="3.5" fill={color} />
      <circle cx="32" cy="37" r="9.5" fill={accent} />
    </svg>
  )
}

/** Mark and name, as in the logo lockup: "Agentic" in 600, "Toolkit" in 400 */
export function Logo({ size = 40, color = 'var(--sf-text)' }: { size?: number; color?: string }) {
  return (
    <span className="sf-logo" style={{ gap: size * 0.26, color }}>
      <LogoMark size={size} color={color} />
      <span className="sf-logo-name" style={{ fontSize: size * 0.58 }}>
        <span style={{ fontWeight: 600 }}>Agentic</span> <span style={{ fontWeight: 400 }}>Toolkit</span>
      </span>
    </span>
  )
}
