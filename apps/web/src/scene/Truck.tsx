import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { POINTS, TRUCK_DRIVE_SECONDS } from '../domain/zones'
import { clock } from '../sources/clock'
import { useStore } from '../store/useStore'

const DOCK_X = POINTS.truckDock[0]
const EXIT_X = 50
const ENTRY_X = -48

export function Truck() {
  const ref = useRef<THREE.Group>(null)
  const select = useStore((s) => s.select)

  useFrame(() => {
    const g = ref.current
    if (!g) return
    const { phase, phaseStartedAt } = useStore.getState().truck
    const p = Math.min(1, (clock.t - phaseStartedAt) / TRUCK_DRIVE_SECONDS)
    let x = DOCK_X
    if (phase === 'outbound') x = DOCK_X + p * p * (EXIT_X - DOCK_X)
    if (phase === 'inbound') x = ENTRY_X + (1 - (1 - p) * (1 - p)) * (DOCK_X - ENTRY_X)
    g.position.set(x, 0, POINTS.roadZ - 0.9)
    g.visible = !(phase === 'outbound' && p >= 1)
  })

  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'zone', id: 'expedicao' })
      }}
    >
      {/* cargo box */}
      <RoundedBox args={[4.2, 2.2, 1.9]} radius={0.12} position={[-0.6, 1.55, 0]} castShadow>
        <meshStandardMaterial color="#ffffff" />
      </RoundedBox>
      <mesh position={[-0.6, 1.3, 0.96]}>
        <boxGeometry args={[3.6, 0.35, 0.02]} />
        <meshStandardMaterial color="#2f5bea" />
      </mesh>
      <mesh position={[-0.6, 1.3, -0.96]}>
        <boxGeometry args={[3.6, 0.35, 0.02]} />
        <meshStandardMaterial color="#2f5bea" />
      </mesh>
      {/* cab */}
      <RoundedBox args={[1.4, 1.7, 1.8]} radius={0.18} position={[2.3, 1.25, 0]} castShadow>
        <meshStandardMaterial color="#2f5bea" />
      </RoundedBox>
      <mesh position={[2.98, 1.55, 0]}>
        <boxGeometry args={[0.06, 0.6, 1.5]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[1.4, 0.4, 0]}>
        <boxGeometry args={[6, 0.25, 1.6]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {[-2.1, -1.1, 2.3].map((wx) =>
        [-0.85, 0.85].map((wz) => (
          <mesh key={`${wx}${wz}`} position={[wx, 0.38, wz]} rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.38, 0.38, 0.3, 18]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        )),
      )}
    </group>
  )
}

/** Decorative traffic so the road feels alive. */
export function Traffic() {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!ref.current) return
    const span = EXIT_X - ENTRY_X
    const x = EXIT_X - (((clock.t * 4) % span) + span) % span
    ref.current.position.set(x, 0, POINTS.roadZ + 1.0)
  })
  return (
    <group ref={ref} rotation-y={Math.PI}>
      <RoundedBox args={[2.6, 1, 1.4]} radius={0.2} position={[0, 0.75, 0]} castShadow>
        <meshStandardMaterial color="#f97316" />
      </RoundedBox>
      <RoundedBox args={[1.4, 0.6, 1.3]} radius={0.2} position={[-0.2, 1.45, 0]} castShadow>
        <meshStandardMaterial color="#fed7aa" />
      </RoundedBox>
    </group>
  )
}
