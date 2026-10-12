import { useEffect, useState } from 'react'

/** Re-renders the component every `ms` (for clock-derived labels). */
export function useTick(ms: number) {
  const [, setN] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => n + 1), ms)
    return () => window.clearInterval(id)
  }, [ms])
}
