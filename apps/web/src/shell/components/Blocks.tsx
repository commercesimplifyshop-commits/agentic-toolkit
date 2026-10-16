import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useDevMode } from '../devmode'
import { useUi } from '../ui-prefs'

export interface Block {
  /** Same id as the page's blocks in apps/api/src/ui/ui-catalog.ts */
  id: string
  /** full: the whole row · half: two per row · third: three per row */
  size: 'full' | 'half' | 'third'
  node: ReactNode
}

/**
 * The blocks of a page in the order the person (or the assistant, or an AI through the MCP) chose,
 * without the hidden ones. With the developer bar's Layout tool on, they are dragged to another place
 * and hidden or shown right on the page. Blocks the preferences do not know keep their place at the end.
 */
export function Blocks({ page, blocks }: { page: string; blocks: Block[] }) {
  const saved = useUi((s) => s.prefs.pages[page])
  const titles = useUi((s) => s.pages.find((p) => p.id === page)?.blocks)
  const apply = useUi((s) => s.apply)
  const editing = useDevMode((s) => s.on && s.tool === 'layout')
  const [dragging, setDragging] = useState<string | null>(null)
  // the block being dragged, read by the drop at once (the state above only drives the looks)
  const dragged = useRef<string | null>(null)
  const [over, setOver] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const order = saved?.order ?? []
  const ranked = [...blocks].sort((a, b) => rank(order, a.id, blocks) - rank(order, b.id, blocks))
  const hidden = (id: string) => Boolean(saved?.hidden.includes(id))

  /** Before or after the block under the pointer: across for blocks side by side, down for full rows */
  const sideOf = (e: DragEvent<HTMLDivElement>, size: Block['size']) => {
    const r = e.currentTarget.getBoundingClientRect()
    const across = size !== 'full'
    return (across ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) ? 'before' : 'after'
  }

  return (
    <div className={`sf-blocks ${editing ? 'editing' : ''}`}>
      {ranked
        .filter((b) => editing || !hidden(b.id))
        .map((b) => (
          <div
            key={b.id}
            className={`sf-block ${b.size} ${hidden(b.id) ? 'is-hidden' : ''} ${dragging === b.id ? 'is-dragging' : ''} ${over?.id === b.id ? `drop-${over.side}` : ''}`}
            data-block={b.id}
            draggable={editing}
            onDragStart={(e) => {
              dragged.current = b.id
              setDragging(b.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', b.id)
            }}
            onDragEnd={() => {
              dragged.current = null
              setDragging(null)
              setOver(null)
            }}
            onDragOver={(e) => {
              if (!editing || !dragged.current || dragged.current === b.id) return
              e.preventDefault()
              const side = sideOf(e, b.size)
              if (over?.id !== b.id || over.side !== side) setOver({ id: b.id, side })
            }}
            onDragLeave={() => over?.id === b.id && setOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              const moved = dragged.current
              const side = sideOf(e, b.size)
              dragged.current = null
              setDragging(null)
              setOver(null)
              if (moved && moved !== b.id) void apply([{ type: 'block-move', page, block: moved, position: side, ref: b.id }])
            }}
          >
            {editing && (
              <div className="sf-block-handle">
                <span>⠿ {titles?.find((t) => t.id === b.id)?.title ?? b.id}</span>
                <button title={hidden(b.id) ? 'Mostrar o bloco' : 'Ocultar o bloco'} onClick={() => void apply([{ type: 'block-visibility', page, block: b.id, visible: hidden(b.id) }])}>
                  {hidden(b.id) ? 'mostrar' : 'ocultar'}
                </button>
              </div>
            )}
            {b.node}
          </div>
        ))}
    </div>
  )
}

const rank = (order: string[], id: string, blocks: Block[]) => {
  const i = order.indexOf(id)
  return i >= 0 ? i : order.length + blocks.findIndex((b) => b.id === id)
}
