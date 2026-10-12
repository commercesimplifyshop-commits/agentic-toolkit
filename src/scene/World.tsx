import { Html, MapControls, OrthographicCamera } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { ZONES, zoneById, type ZoneId } from '../domain/zones'
import type { FulfillmentStage } from '../domain/types'
import { useStore, type Selection } from '../store/useStore'
import { useMap } from '../map/useMap'
import { useDebug } from '../debug/useDebug'
import { Customers } from './Customers'
import { DebugToken } from './DebugToken'
import { livePositions } from './layout'
import { Orders } from './Orders'
import {
  AdminOffice, CartArea, IntegrationHub, CatalogShelves, CheckoutCounters, Dock, Entrance, Forklift, Ground, ProductPedestal, Road, Trees,
  Warehouse, ZonePads,
} from './Props'
import { Traffic, Truck } from './Truck'

const CAMERA_OFFSET = new THREE.Vector3(30, 32, 30)
const HOME_TARGET = new THREE.Vector3(3, 0, 2)

const STAGE_ZONE: Record<FulfillmentStage, ZoneId> = {
  awaiting_payment: 'admin',
  invoiced: 'admin',
  canceled: 'admin',
  picking: 'armazem',
  packing: 'armazem',
  awaiting_pickup: 'expedicao',
  in_transit: 'expedicao',
  delivered: 'expedicao',
}

function zoneCenter(id: ZoneId) {
  const [x, z] = zoneById(id).center
  return new THREE.Vector3(x, 0, z)
}

function focusPoint(sel: Selection): THREE.Vector3 | null {
  if (!sel) return null
  if (sel.kind === 'zone') return zoneCenter(sel.id)
  if (sel.kind === 'unmapped' || sel.kind === 'risks') return null
  const live = livePositions.get(sel.id)
  if (live) return live.clone().setY(0)
  if (sel.kind === 'order') {
    const order = useStore.getState().orders[sel.id]
    return order ? zoneCenter(STAGE_ZONE[order.stage]) : null
  }
  return null
}

function CameraRig() {
  const focusVersion = useStore((s) => s.focusVersion)
  const controls = useThree((s) => s.controls) as MapControlsImpl | null
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const width = useThree((s) => s.size.width)
  const goal = useRef<{ to: THREE.Vector3; until: number } | null>(null)

  useEffect(() => {
    camera.zoom = THREE.MathUtils.clamp(width / 86, 8, 30)
    camera.updateProjectionMatrix()
  }, [camera, width])

  useEffect(() => {
    if (focusVersion === 0) return
    const to = focusPoint(useStore.getState().selection)
    if (to) goal.current = { to, until: performance.now() + 1600 }
  }, [focusVersion])

  useFrame((_, dt) => {
    if (!goal.current || !controls) return
    const target = controls.target
    const offset = camera.position.clone().sub(target)
    target.lerp(goal.current.to, 1 - Math.exp(-dt * 4.5))
    camera.position.copy(target).add(offset)
    controls.update()
    if (target.distanceTo(goal.current.to) < 0.02 || performance.now() > goal.current.until) goal.current = null
  })

  return null
}

function ZoneLabels() {
  const select = useStore((s) => s.select)
  const selection = useStore((s) => s.selection)
  const map = useMap((s) => s.map)
  const customByZone = (id: string) => map?.items.filter((i) => i.zone === id && i.origin !== 'native').length ?? 0
  return (
    <group>
      {ZONES.map((z) => {
        const active = selection?.kind === 'zone' && selection.id === z.id
        const tall = z.id === 'admin' || z.id === 'armazem' || z.id === 'integracoes'
        return (
          <Html key={z.id} position={[z.center[0], tall ? 4.6 : 3, z.center[1]]} center zIndexRange={[10, 0]}>
            <button className={`zone-tag ${active ? 'active' : ''}`} onClick={() => select({ kind: 'zone', id: z.id })}>
              <span className="num">{z.step}</span>
              {z.name}
              {map && <span className="custom-chip" title="customizações nesta etapa">{customByZone(z.id)}</span>}
            </button>
          </Html>
        )
      })}
    </group>
  )
}

export function World() {
  const debugging = useDebug((s) => s.active)
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#e6ebf7']} />
      <OrthographicCamera makeDefault position={HOME_TARGET.clone().add(CAMERA_OFFSET).toArray()} near={0.1} far={400} />
      <MapControls
        makeDefault
        target={HOME_TARGET.toArray()}
        enableDamping
        dampingFactor={0.12}
        minZoom={8}
        maxZoom={70}
        minPolarAngle={0.45}
        maxPolarAngle={1.15}
      />
      <CameraRig />

      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#c7d2fe', 0.6]} />
      <directionalLight
        position={[18, 34, 16]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
        shadow-camera-far={120}
        shadow-bias={-0.0005}
      />

      <Ground />
      <Road />
      <ZonePads />
      <Entrance />
      <CatalogShelves />
      <ProductPedestal />
      <CartArea />
      <CheckoutCounters />
      <AdminOffice />
      <Warehouse />
      <Forklift />
      <Dock />
      <IntegrationHub />
      <Trees />
      <Truck />
      <Traffic />
      {debugging ? (
        <DebugToken />
      ) : (
        <>
          <Customers />
          <Orders />
        </>
      )}
      <ZoneLabels />
    </Canvas>
  )
}
