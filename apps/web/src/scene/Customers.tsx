import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { POINTS } from '../domain/zones'
import { useStore } from '../store/useStore'
import { STAGE_LABEL } from '../ui/labels'
import { CORRIDOR_Z, customerTarget, hash, livePositions } from './layout'

const WALK_SPEED = 3.6
const SKIN = ['#f1c7a5', '#e0ac85', '#b9805a', '#8a5a3b']

export function Customers() {
  const ids = useStore(useShallow((s) => Object.keys(s.customers)))
  return (
    <group>
      {ids.map((id) => (
        <Avatar key={id} id={id} />
      ))}
    </group>
  )
}

function Avatar({ id }: { id: string }) {
  const c = useStore((s) => s.customers[id])
  const selected = useStore((s) => s.selection?.kind === 'customer' && s.selection.id === id)
  const select = useStore((s) => s.select)
  const [hovered, setHovered] = useState(false)

  const group = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const waypoints = useRef<THREE.Vector3[]>([])
  const targetKey = useRef('')
  const step = useRef(0)

  useEffect(() => () => void livePositions.delete(id), [id])

  useFrame((_, dt) => {
    const g = group.current
    if (!g || !c) return
    if (!livePositions.has(id)) {
      g.position.set(POINTS.spawn[0], 0, POINTS.spawn[1] + (hash(id, 3) - 0.5) * 2)
      livePositions.set(id, g.position)
    }

    const [tx, tz] = customerTarget(c)
    const key = `${tx.toFixed(2)},${tz.toFixed(2)}`
    if (key !== targetKey.current) {
      targetKey.current = key
      const far = Math.hypot(g.position.x - tx, g.position.z - tz) > 3.5
      waypoints.current = far
        ? [new THREE.Vector3(g.position.x, 0, CORRIDOR_Z), new THREE.Vector3(tx, 0, CORRIDOR_Z), new THREE.Vector3(tx, 0, tz)]
        : [new THREE.Vector3(tx, 0, tz)]
    }

    const { speed, paused } = useStore.getState()
    const next = waypoints.current[0]
    let moving = false
    if (next && !paused) {
      const dir = next.clone().sub(g.position)
      const dist = dir.length()
      const stepLen = WALK_SPEED * speed * dt
      if (dist <= stepLen) {
        g.position.copy(next)
        waypoints.current.shift()
      } else {
        g.position.addScaledVector(dir.normalize(), stepLen)
        g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, Math.atan2(dir.x, dir.z), 0.25)
        moving = true
      }
    }
    if (body.current) {
      step.current += moving ? dt * speed * 14 : 0
      body.current.position.y = moving ? Math.abs(Math.sin(step.current)) * 0.1 : 0
    }
  })

  if (!c) return null
  const highlight = selected || hovered
  const skin = SKIN[Math.floor(hash(id, 4) * SKIN.length)]

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'customer', id })
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = ''
      }}
    >
      <group ref={body}>
        <mesh position={[0, 0.58, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.45, 4, 12]} />
          <meshStandardMaterial color={c.color} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.13, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={skin} roughness={0.7} />
        </mesh>
        {c.cart.length > 0 && (
          <mesh position={[0.36, 0.55, 0.1]} castShadow>
            <boxGeometry args={[0.28, 0.24, 0.36]} />
            <meshStandardMaterial color="#22c55e" />
          </mesh>
        )}
        {c.endReason === 'ordered' && (
          <mesh position={[0.36, 0.5, 0.1]} castShadow>
            <boxGeometry args={[0.3, 0.38, 0.14]} />
            <meshStandardMaterial color="#2f5bea" />
          </mesh>
        )}
      </group>
      {highlight && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
          <ringGeometry args={[0.38, 0.5, 32]} />
          <meshBasicMaterial color={selected ? '#2f5bea' : '#64748b'} />
        </mesh>
      )}
      {highlight && (
        <Html position={[0, 1.7, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bubble">
            <strong>{c.label}</strong>
            <span>{STAGE_LABEL[c.stage]}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
