import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { FulfillmentStage, Order } from '../domain/types'
import { POINTS } from '../domain/zones'
import { clock } from '../sources/clock'
import { useStore } from '../store/useStore'
import { livePositions, orderSlot } from './layout'

const CANCELED_VISIBLE_FOR = 8

export function Orders() {
  const orders = useStore((s) => s.orders)
  const trackedOrderId = useStore((s) => s.trackedOrderId)

  const placed = useMemo(() => {
    const perStage: Partial<Record<FulfillmentStage, number>> = {}
    return Object.values(orders)
      .filter((o) => o.stage !== 'in_transit' && o.stage !== 'delivered')
      .filter((o) => o.stage !== 'canceled' || clock.t - o.updatedAt < CANCELED_VISIBLE_FOR)
      .sort((a, b) => a.placedAt - b.placedAt)
      .map((o) => {
        const idx = perStage[o.stage] ?? 0
        perStage[o.stage] = idx + 1
        return { order: o, idx }
      })
  }, [orders])

  return (
    <group>
      {placed.map(({ order, idx }) => (
        <OrderItem key={order.incrementId} order={order} idx={idx} tracked={order.incrementId === trackedOrderId} />
      ))}
    </group>
  )
}

const CARD_COLOR: Partial<Record<FulfillmentStage, string>> = {
  awaiting_payment: '#fbbf24',
  invoiced: '#22c55e',
  canceled: '#ef4444',
}

function OrderItem({ order, idx, tracked }: { order: Order; idx: number; tracked: boolean }) {
  const select = useStore((s) => s.select)
  const group = useRef<THREE.Group>(null)
  const pin = useRef<THREE.Group>(null)
  useEffect(() => () => void livePositions.delete(order.incrementId), [order.incrementId])

  const isCard = order.stage === 'awaiting_payment' || order.stage === 'invoiced' || order.stage === 'canceled'

  useFrame((state, dt) => {
    const g = group.current
    const target = orderSlot(order.stage, idx)
    if (!g || !target) return
    if (!livePositions.has(order.incrementId)) {
      g.position.set(POINTS.paymentCounter[0], 1.4, POINTS.paymentCounter[1])
      livePositions.set(order.incrementId, g.position)
    }
    const { speed, paused } = useStore.getState()
    if (!paused) {
      // Arc while travelling between zones
      const remaining = Math.hypot(target.x - g.position.x, target.z - g.position.z)
      const goal = target.clone().setY(target.y + Math.min(remaining * 0.18, 2.5))
      g.position.lerp(goal, 1 - Math.exp(-dt * 2.2 * speed))
    }
    if (isCard) g.rotation.y = Math.sin(state.clock.elapsedTime * 1.5 + idx) * 0.15
    if (pin.current) pin.current.position.y = 1.3 + Math.sin(state.clock.elapsedTime * 3) * 0.12
  })

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'order', id: order.incrementId })
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      {isCard ? (
        <group scale={1.5}>
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.05, 0.56]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.03, -0.17]}>
            <boxGeometry args={[0.32, 0.01, 0.1]} />
            <meshStandardMaterial color={CARD_COLOR[order.stage]} />
          </mesh>
          {[0, 0.1, 0.2].map((z) => (
            <mesh key={z} position={[0, 0.03, z]}>
              <boxGeometry args={[0.3, 0.01, 0.04]} />
              <meshStandardMaterial color="#cbd5e1" />
            </mesh>
          ))}
        </group>
      ) : (
        <group scale={1.4}>
          <mesh castShadow>
            <boxGeometry args={[0.55, 0.45, 0.55]} />
            <meshStandardMaterial color={order.stage === 'picking' ? '#e7b77a' : '#c98f4f'} roughness={0.8} />
          </mesh>
          {order.stage !== 'picking' && (
            <mesh position={[0, 0.226, 0]}>
              <boxGeometry args={[0.56, 0.01, 0.12]} />
              <meshStandardMaterial color="#2f5bea" />
            </mesh>
          )}
        </group>
      )}
      {tracked && (
        <group ref={pin} position={[0, 1.3, 0]}>
          <mesh position={[0, 0.25, 0]}>
            <sphereGeometry args={[0.24, 20, 20]} />
            <meshStandardMaterial color="#2f5bea" />
          </mesh>
          <mesh position={[0, 0.25, 0.2]}>
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, -0.12, 0]} rotation-x={Math.PI}>
            <coneGeometry args={[0.17, 0.45, 20]} />
            <meshStandardMaterial color="#2f5bea" />
          </mesh>
        </group>
      )}
    </group>
  )
}
