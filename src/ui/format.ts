const brlFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const brl = (v: number) => brlFormat.format(v)

export const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`

// Sim time is seconds since the store "opened" at 09:00
export function clockLabel(t: number) {
  const minutes = 9 * 60 + Math.floor(t / 2) // 1 sim second = 30 store seconds
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
