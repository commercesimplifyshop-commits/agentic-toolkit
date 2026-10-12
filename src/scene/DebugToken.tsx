import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { POINTS, zoneById, type ZoneId } from '../domain/zones'
import { useDebug } from '../debug/useDebug'
import { livePositions } from './layout'

/** Where the debugged flow stands inside each zone */
const SPOT: Partial<Record<ZoneId, [number, number]>> = {
  entrada: [-18, 4],
  catalogo: [-10, -4.1],
  produto: [-10, 7.8],
  carrinho: [-1, 6],
  checkout: [POINTS.paymentCounter[0] - 1, POINTS.paymentCounter[1] + 2],
  admin: [POINTS.adminDesk[0], POINTS.adminDesk[1] + 0.6],
  expedicao: [POINTS.dock[0] + 1, POINTS.dock[1]],
}

const spotOf = (zone: ZoneId) => SPOT[zone] ?? zoneById(zone).center

export function DebugToken() {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const { traces, stepIndex, executed, phase } = useDebug()
  const trace = traces[stepIndex]
  const isOrder = traces.findIndex((t) => t.step.id === 'place-order') < stepIndex
  const current = trace?.frames[executed - 1]

  useFrame((state, dt) => {
    const g = group.current
    if (!g || !trace) return
    const [x, z] = spotOf(trace.step.zone)
    if (!livePositions.has('debug-token')) {
      g.position.set(x, 0, z)
      livePositions.set('debug-token', g.position)
    }
    const { speed, playing } = useDebug.getState()
    g.position.lerp(new THREE.Vector3(x, 0, z), 1 - Math.exp(-dt * 2.5 * (playing ? speed : 3)))
    if (ring.current) {
      const s = 1 + (Math.sin(state.clock.elapsedTime * 4) + 1) * 0.15
      ring.current.scale.set(s, s, s)
    }
  })

  if (!trace) return null
  const custom = current && current.origin !== 'native'

  return (
    <group ref={group}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[0.6, 0.78, 40]} />
        <meshBasicMaterial color={custom ? '#ea580c' : '#2f5bea'} transparent opacity={0.85} />
      </mesh>
      {isOrder ? (
        <group position={[0, 0.55, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.9, 0.75, 0.9]} />
            <meshStandardMaterial color="#c98f4f" />
          </mesh>
          <mesh position={[0, 0.38, 0]}>
            <boxGeometry args={[0.92, 0.02, 0.2]} />
            <meshStandardMaterial color="#2f5bea" />
          </mesh>
        </group>
      ) : (
        <group scale={1.5}>
          <mesh position={[0, 0.58, 0]} castShadow>
            <capsuleGeometry args={[0.24, 0.45, 4, 12]} />
            <meshStandardMaterial color="#2f5bea" />
          </mesh>
          <mesh position={[0, 1.13, 0]} castShadow>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshStandardMaterial color="#e0ac85" />
          </mesh>
        </group>
      )}
      <Html position={[0, 2.6, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`bubble debug-bubble ${custom ? 'custom' : ''}`}>
          <strong>{phase === 'walking' ? trace.step.title : (current?.label ?? trace.step.title)}</strong>
          <span>{phase === 'walking' ? trace.step.request : (current?.detail ?? trace.step.request)}</span>
        </div>
      </Html>
    </group>
  )
}
