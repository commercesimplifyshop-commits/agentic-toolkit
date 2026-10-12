import { lazy, Suspense, useEffect } from 'react'
import { GoToPopup } from './GoToPopup'
import { useIde } from './useIde'

// Find in Files embeds the CodeMirror preview: load it only when opened
const FindInFiles = lazy(() => import('./FindInFiles').then((m) => ({ default: m.FindInFiles })))

const selectedText = () => window.getSelection()?.toString().trim().split('\n')[0].slice(0, 200) || undefined

/**
 * PhpStorm keyboard navigation, available on every page of a workspace:
 *  Shift Shift            Search Everywhere
 *  Alt+N                  Go to Class   (Ctrl+N is reserved by the browser)
 *  Alt+Shift+N            Go to File    (Ctrl+Shift+N is reserved by the browser)
 *  Ctrl+Shift+F / Alt+F   Find in Files
 */
export function IdeLayer({ workspaceId }: { workspaceId: string }) {
  const { popup, open, ensureIndex } = useIde()

  useEffect(() => {
    ensureIndex(workspaceId).catch(() => undefined)
  }, [workspaceId, ensureIndex])

  useEffect(() => {
    let lastShift = 0
    let dirty = false
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.key !== 'Shift') dirty = true
      // Esc closes any search popup, wherever the focus is (list, buttons, preview…)
      if (e.key === 'Escape' && useIde.getState().popup) {
        e.preventDefault()
        e.stopPropagation()
        useIde.getState().close()
        return
      }
      if ((e.ctrlKey && e.shiftKey && k === 'f') || (e.altKey && !e.shiftKey && !e.ctrlKey && k === 'f')) {
        e.preventDefault()
        open({ kind: 'find', initial: selectedText() })
      } else if (e.altKey && e.shiftKey && k === 'n') {
        e.preventDefault()
        open({ kind: 'goto', mode: 'file', initial: selectedText() })
      } else if (e.altKey && !e.shiftKey && k === 'n') {
        e.preventDefault()
        open({ kind: 'goto', mode: 'class', initial: selectedText() })
      } else if (e.key === 'Shift' && !e.repeat) {
        dirty = false
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || dirty) return
      const now = Date.now()
      if (now - lastShift < 350) {
        lastShift = 0
        open({ kind: 'goto', mode: 'all' })
      } else lastShift = now
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [open])

  if (popup?.kind === 'goto') return <GoToPopup key={popup.mode} workspaceId={workspaceId} mode={popup.mode} initial={popup.initial} />
  if (popup?.kind === 'find')
    return (
      <Suspense fallback={null}>
        <FindInFiles workspaceId={workspaceId} initial={popup.initial} />
      </Suspense>
    )
  return null
}
