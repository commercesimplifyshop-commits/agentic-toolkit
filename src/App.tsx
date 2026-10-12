import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebug } from './debug/useDebug'
import { World } from './scene/World'
import { clock } from './sources/clock'
import { createMockSource } from './sources/mockSource'
import { startRuntime } from './sources/runtime'
import { useMap } from './map/useMap'
import { useStore } from './store/useStore'
import { EventFeed } from './ui/EventFeed'
import { FlowNav } from './ui/FlowNav'
import { MapBar } from './ui/MapBar'
import { OrderTracker } from './ui/OrderTracker'
import { SidePanel } from './ui/SidePanel'
import { TopBar } from './ui/TopBar'
import { DebugControls } from './ui/debug/DebugControls'
import { DebugPanel } from './ui/debug/DebugPanel'
import { DebugSteps } from './ui/debug/DebugSteps'

export function App() {
  const [run, setRun] = useState(0)
  const [sourceLabel, setSourceLabel] = useState('')
  const stopRef = useRef<() => void>()

  useEffect(() => {
    const source = createMockSource()
    setSourceLabel(source.label)
    stopRef.current = startRuntime(source)
    return () => stopRef.current?.()
  }, [run])

  const debugging = useDebug((s) => s.active)

  useEffect(() => {
    useMap.getState().init()
  }, [])

  // Debug playback clock
  useEffect(() => {
    if (!debugging) return
    let last = performance.now()
    let raf = requestAnimationFrame(function loop(now) {
      useDebug.getState().tick((now - last) / 1000)
      last = now
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [debugging])

  const reset = useCallback(() => {
    stopRef.current?.()
    clock.t = 0
    useStore.getState().reset()
    setRun((n) => n + 1)
  }, [])

  return (
    <div className="app">
      <World />
      <TopBar sourceLabel={sourceLabel} onReset={reset} />
      <MapBar />
      {debugging ? (
        <>
          <div className="left-col">
            <DebugSteps />
          </div>
          <DebugPanel />
          <DebugControls />
        </>
      ) : (
        <>
          <div className="left-col">
            <FlowNav />
            <EventFeed />
          </div>
          <SidePanel />
          <OrderTracker />
        </>
      )}
    </div>
  )
}
