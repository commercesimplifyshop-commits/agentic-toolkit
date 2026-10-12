import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CATEGORIES } from '../domain/catalog'
import { POINTS, SHELF_ROWS, ZONES } from '../domain/zones'
import { useStore } from '../store/useStore'

const BLUE = '#2f5bea'
const BLUE_LIGHT = '#5b82ff'
const WOOD = '#d9a66b'

type V3 = [number, number, number]

function Box({ position, size, color, radius = 0.06, ...rest }: { position: V3; size: V3; color: string; radius?: number; rotation?: V3 }) {
  return (
    <RoundedBox args={size} radius={Math.min(radius, ...size.map((s) => s / 2.01))} position={position} castShadow receiveShadow {...rest}>
      <meshStandardMaterial color={color} roughness={0.75} />
    </RoundedBox>
  )
}

// ---- ground & zones --------------------------------------------------------

export function Ground() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[2, -0.01, 2]} receiveShadow>
        <planeGeometry args={[160, 120]} />
        <meshStandardMaterial color="#e6ebf7" />
      </mesh>
      {/* storefront floor */}
      <mesh rotation-x={-Math.PI / 2} position={[-9.5, 0.005, 0]} receiveShadow>
        <planeGeometry args={[29, 19]} />
        <meshStandardMaterial color="#f7f8fc" />
      </mesh>
      {/* corridor between zones */}
      <mesh rotation-x={-Math.PI / 2} position={[-6, 0.01, 2.2]} receiveShadow>
        <planeGeometry args={[34, 1.2]} />
        <meshStandardMaterial color="#e3e8f5" />
      </mesh>
      {/* back-office yard */}
      <mesh rotation-x={-Math.PI / 2} position={[15.5, 0.005, 0.5]} receiveShadow>
        <planeGeometry args={[21, 22]} />
        <meshStandardMaterial color="#edf0f7" />
      </mesh>
    </group>
  )
}

export function Road() {
  const dashes = useMemo(() => Array.from({ length: 30 }, (_, i) => -42 + i * 3), [])
  return (
    <group position={[0, 0.02, POINTS.roadZ]}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[100, 4]} />
        <meshStandardMaterial color="#c9d1e6" />
      </mesh>
      {dashes.map((x) => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.01, 0]}>
          <planeGeometry args={[1.4, 0.14]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, -2.2]}>
        <planeGeometry args={[100, 0.4]} />
        <meshStandardMaterial color="#dfe5f3" />
      </mesh>
    </group>
  )
}

export function ZonePads() {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  return (
    <group>
      {ZONES.map((z) => {
        const active = selection?.kind === 'zone' && selection.id === z.id
        return (
          <group key={z.id} position={[z.center[0], 0.03, z.center[1]]}>
            <mesh
              rotation-x={-Math.PI / 2}
              receiveShadow
              onClick={(e) => {
                e.stopPropagation()
                select({ kind: 'zone', id: z.id })
              }}
              onPointerOver={() => (document.body.style.cursor = 'pointer')}
              onPointerOut={() => (document.body.style.cursor = '')}
            >
              <planeGeometry args={z.size} />
              <meshStandardMaterial color={z.color} transparent opacity={active ? 0.95 : 0.6} />
            </mesh>
            {active && <ZoneOutline size={z.size} />}
          </group>
        )
      })}
    </group>
  )
}

function ZoneOutline({ size }: { size: [number, number] }) {
  const ref = useRef<THREE.LineSegments>(null)
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(size[0] + 0.3, size[1] + 0.3)), [size])
  useFrame(({ clock: c }) => {
    if (ref.current) (ref.current.material as THREE.LineBasicMaterial).opacity = 0.55 + Math.sin(c.elapsedTime * 4) * 0.35
  })
  return (
    <lineSegments ref={ref} geometry={geometry} rotation-x={-Math.PI / 2} position-y={0.02}>
      <lineBasicMaterial color={BLUE} transparent />
    </lineSegments>
  )
}

// ---- storefront ------------------------------------------------------------

export function Entrance() {
  const [x, z] = POINTS.door
  return (
    <group position={[x, 0, z]}>
      <Box position={[0, 1.4, -2.2]} size={[0.5, 2.8, 0.5]} color={BLUE} />
      <Box position={[0, 1.4, 2.2]} size={[0.5, 2.8, 0.5]} color={BLUE} />
      <Box position={[0, 3, 0]} size={[0.7, 0.6, 5]} color={BLUE_LIGHT} />
      <Box position={[0.4, 3, 0]} size={[0.08, 0.36, 3]} color="#ffffff" />
      <mesh rotation-x={-Math.PI / 2} position={[1.2, 0.04, 0]}>
        <planeGeometry args={[1.6, 3.4]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
    </group>
  )
}

export function CatalogShelves() {
  const products = useStore((s) => s.products)
  return (
    <group>
      {CATEGORIES.map((cat) => {
        const z = SHELF_ROWS[cat.id]
        const items = products.filter((p) => p.categoryId === cat.id)
        return (
          <group key={cat.id} position={[-10, 0, z]}>
            {[-4.4, -1.5, 1.5, 4.4].map((x) => (
              <Box key={x} position={[x, 0.9, 0]} size={[0.12, 1.8, 0.7]} color={BLUE} />
            ))}
            {[0.15, 0.85, 1.55].map((y) => (
              <Box key={y} position={[0, y, 0]} size={[9, 0.08, 0.72]} color="#dbe3f7" />
            ))}
            <Box position={[-4.75, 1.95, 0]} size={[0.5, 0.5, 0.5]} color={cat.color} radius={0.25} />
            {items.map((p, i) => {
              const units = Math.min(3, Math.ceil(p.stock / 4))
              return Array.from({ length: units }, (_, u) => (
                <mesh key={`${p.sku}-${u}`} position={[-3.6 + i * 2.25 + u * 0.48, 0.42 + (u === 2 ? 0.7 : 0), 0]} castShadow>
                  <boxGeometry args={[0.4, 0.5, 0.45]} />
                  <meshStandardMaterial color={p.color} roughness={0.6} />
                </mesh>
              ))
            })}
          </group>
        )
      })}
    </group>
  )
}

export function ProductPedestal() {
  const ref = useRef<THREE.Mesh>(null)
  const color = useStore((s) => {
    const viewing = Object.values(s.customers).filter((c) => c.stage === 'viewing_product' && c.viewingSku)
    const sku = viewing[viewing.length - 1]?.viewingSku
    return s.products.find((p) => p.sku === sku)?.color ?? '#cbd5e1'
  })
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.9
  })
  const [x, z] = POINTS.pdpPedestal
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1.15, 0.6, 32]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.04, 32]} />
        <meshStandardMaterial color={BLUE_LIGHT} emissive={BLUE_LIGHT} emissiveIntensity={0.4} />
      </mesh>
      <mesh ref={ref} position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* product info screen */}
      <group position={[0, 0, -1.9]}>
        <Box position={[0, 1.2, 0]} size={[2.6, 1.6, 0.12]} color="#1e293b" />
        <Box position={[-0.5, 1.3, 0.08]} size={[1, 1, 0.02]} color={color} />
        <Box position={[0.6, 1.55, 0.08]} size={[0.9, 0.12, 0.02]} color="#e2e8f0" />
        <Box position={[0.6, 1.3, 0.08]} size={[0.6, 0.12, 0.02]} color="#94a3b8" />
        <Box position={[0.6, 0.95, 0.08]} size={[0.9, 0.28, 0.02]} color="#22c55e" />
        <Box position={[0, 0.2, 0]} size={[0.2, 0.4, 0.2]} color="#334155" />
      </group>
    </group>
  )
}

function ShoppingCartProp({ position, rotation = 0 }: { position: V3; rotation?: number }) {
  return (
    <group position={position} rotation-y={rotation}>
      <Box position={[0, 0.65, 0]} size={[0.9, 0.5, 0.6]} color="#93c5fd" radius={0.04} />
      <Box position={[-0.5, 0.95, 0]} size={[0.06, 0.6, 0.6]} color={BLUE} />
      {[[-0.35, -0.22], [0.35, -0.22], [-0.35, 0.22], [0.35, 0.22]].map(([wx, wz]) => (
        <mesh key={`${wx}${wz}`} position={[wx, 0.12, wz]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.1, 0.1, 0.06, 12]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      ))}
      <Box position={[0, 0.38, 0]} size={[0.8, 0.04, 0.5]} color="#cbd5e1" />
    </group>
  )
}

export function CartArea() {
  return (
    <group>
      <ShoppingCartProp position={[-3.3, 0, 4.2]} rotation={0.3} />
      <ShoppingCartProp position={[-2.6, 0, 4.0]} rotation={0.3} />
      <ShoppingCartProp position={[1.6, 0, 7.8]} rotation={-0.6} />
      <Box position={[1.8, 0.6, 4.3]} size={[0.9, 1.2, 0.9]} color={BLUE} radius={0.15} />
      <Box position={[1.8, 1.25, 4.3]} size={[0.7, 0.1, 0.7]} color="#22c55e" />
    </group>
  )
}

function Counter({ position, accent }: { position: V3; accent: string }) {
  return (
    <group position={position}>
      <Box position={[0, 0.55, 0]} size={[2.4, 1.1, 0.9]} color="#ffffff" />
      <Box position={[0, 1.12, 0]} size={[2.5, 0.08, 1]} color={accent} />
      <Box position={[0.5, 1.45, -0.15]} size={[0.8, 0.55, 0.06]} rotation={[-0.25, 0, 0]} color="#1e293b" />
      <Box position={[-0.6, 1.25, 0.1]} size={[0.4, 0.2, 0.3]} color="#475569" />
    </group>
  )
}

export function CheckoutCounters() {
  return (
    <group>
      <Counter position={[POINTS.shippingCounter[0], 0, POINTS.shippingCounter[1]]} accent="#38bdf8" />
      <Counter position={[POINTS.paymentCounter[0], 0, POINTS.paymentCounter[1]]} accent="#22c55e" />
      {[POINTS.shippingCounter, POINTS.paymentCounter].map(([x, z]) =>
        [-0.9, 0.9].map((dx) => <Box key={`${x}${dx}`} position={[x + dx, 0.45, z + 4.8]} size={[0.12, 0.9, 0.12]} color="#94a3b8" />),
      )}
    </group>
  )
}

// ---- back-office ------------------------------------------------------------

function Building({ center, size, height, label }: { center: [number, number]; size: [number, number]; height: number; label?: string }) {
  const [cx, cz] = center
  const [w, d] = size
  return (
    <group position={[cx, 0, cz]}>
      {/* back and left walls only: the camera looks from +x/+z */}
      <Box position={[0, height / 2, -d / 2]} size={[w, height, 0.3]} color={BLUE} />
      <Box position={[-w / 2, height / 2, 0]} size={[0.3, height, d]} color={BLUE} />
      <Box position={[0, height + 0.12, -d / 2 - 0.05]} size={[w + 0.3, 0.25, 0.6]} color={BLUE_LIGHT} />
      <Box position={[-w / 2 - 0.05, height + 0.12, 0]} size={[0.6, 0.25, d + 0.3]} color={BLUE_LIGHT} />
      {label && <Box position={[0, height * 0.72, -d / 2 + 0.17]} size={[2.2, 0.55, 0.05]} color="#ffffff" />}
      {/* corner posts on the open sides */}
      <Box position={[w / 2, height / 2, d / 2]} size={[0.3, height, 0.3]} color={BLUE} />
      <Box position={[w / 2, height / 2, -d / 2]} size={[0.3, height, 0.3]} color={BLUE} />
      <Box position={[-w / 2, height / 2, d / 2]} size={[0.3, height, 0.3]} color={BLUE} />
    </group>
  )
}

export function AdminOffice() {
  const [x, z] = POINTS.adminDesk
  return (
    <group>
      <Building center={[x, z]} size={[7, 7]} height={2.6} label="admin" />
      {/* long desk where orders land */}
      <Box position={[x - 1.4, 0.5, z - 1]} size={[2.8, 1, 2]} color="#ffffff" />
      <Box position={[x + 1.6, 0.5, z - 1]} size={[2.8, 1, 2]} color="#ffffff" />
      <Box position={[x + 1.6, 0.5, z + 1.5]} size={[2.8, 1, 1.2]} color="#fff1f2" />
      {[x - 2.6, x - 0.2, x + 2.8].map((mx) => (
        <Box key={mx} position={[mx, 1.4, z - 3]} size={[1, 0.7, 0.08]} color="#1e293b" />
      ))}
      {/* office chairs */}
      {[x - 1.5, x + 1.5].map((cx) => (
        <Box key={cx} position={[cx, 0.4, z + 2.4]} size={[0.6, 0.8, 0.6]} color="#64748b" radius={0.15} />
      ))}
    </group>
  )
}

export function Warehouse() {
  const [px, pz] = POINTS.picking
  const [kx, kz] = POINTS.packing
  return (
    <group>
      <Building center={[19, -3]} size={[10, 10]} height={3.6} label="CD-01" />
      {/* picking racks */}
      {[-6.6, -5.2].map((rz) => (
        <group key={rz} position={[px, 0, rz]}>
          {[-1.6, 0, 1.6].map((rx) => <Box key={rx} position={[rx, 1.2, 0]} size={[0.1, 2.4, 0.8]} color="#1d4ed8" />)}
          {[0.5, 1.4, 2.3].map((ry) => <Box key={ry} position={[0, ry, 0]} size={[3.3, 0.08, 0.8]} color="#f97316" />)}
          {[-0.8, 0.8].map((bx) =>
            [0.8, 1.7].map((by) => <Box key={`${bx}${by}`} position={[bx, by, 0]} size={[1.2, 0.6, 0.6]} color={WOOD} radius={0.03} />),
          )}
        </group>
      ))}
      {/* pallet floor for picking */}
      <mesh rotation-x={-Math.PI / 2} position={[px, 0.05, pz - 0.2]}>
        <planeGeometry args={[3.8, 3]} />
        <meshStandardMaterial color="#fde68a" />
      </mesh>
      {/* packing table + conveyor */}
      <Box position={[kx, 0.45, kz + 0.5]} size={[3.6, 0.9, 2.2]} color="#e2e8f0" />
      <Box position={[kx, 0.93, kz + 0.5]} size={[3.6, 0.06, 2.2]} color="#334155" />
      <Box position={[kx + 2.8, 0.5, kz + 3]} size={[1, 1, 4]} color="#475569" />
      <Box position={[kx - 0.5, 0.25, kz - 2.6]} size={[1.6, 0.5, 1.2]} color={WOOD} />
    </group>
  )
}

export function Dock() {
  const [x, z] = POINTS.dock
  return (
    <group>
      {/* pallets */}
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} position={[x - 1.6 + i * 0.8, 0.12, z - 0.1]} size={[0.75, 0.2, 2.6]} color={WOOD} radius={0.02} />
      ))}
      {/* dock bumper */}
      <Box position={[21, 0.4, 10.4]} size={[4, 0.8, 0.5]} color="#facc15" />
      <Box position={[24.2, 1.4, 7.6]} size={[0.3, 2.8, 4.4]} color={BLUE} />
      {/* shipping container */}
      <group position={[27.5, 0, 4]} rotation-y={Math.PI / 2}>
        <Box position={[0, 1.3, 0]} size={[6, 2.6, 2.4]} color="#14b8a6" radius={0.08} />
        {[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((rx) => <Box key={rx} position={[rx, 1.3, 1.22]} size={[0.12, 2.4, 0.04]} color="#0f766e" />)}
      </group>
    </group>
  )
}

export function Forklift() {
  const ref = useRef<THREE.Group>(null)
  const pos = useRef(0)
  useFrame((_, dt) => {
    const { speed, paused } = useStore.getState()
    if (!ref.current || paused) return
    pos.current += dt * speed * 0.35
    const t = (Math.sin(pos.current) + 1) / 2
    ref.current.position.set(16 + t * 5, 0, -0.4 + Math.sin(pos.current * 2) * 0.3)
    ref.current.rotation.y = Math.cos(pos.current) > 0 ? 0 : Math.PI
  })
  return (
    <group ref={ref}>
      <Box position={[0, 0.5, 0]} size={[1.2, 0.6, 0.8]} color="#facc15" />
      <Box position={[-0.2, 1.1, 0]} size={[0.6, 0.6, 0.7]} color="#1e293b" />
      <Box position={[0.7, 0.9, 0]} size={[0.08, 1.6, 0.6]} color="#334155" />
      <Box position={[1, 0.15, 0]} size={[0.6, 0.06, 0.5]} color="#334155" />
      <Box position={[1, 0.45, 0]} size={[0.5, 0.5, 0.45]} color={WOOD} radius={0.03} />
    </group>
  )
}

const TREES: [number, number, number][] = [
  [-27, -8, 1.1], [-25, -12, 0.9], [-20, -11, 1.2], [-14, -12, 1], [-6, -12, 1.1], [2, -11.5, 0.9],
  [6, -11, 1.2], [13, -11.5, 1], [26, -10, 1.1], [29, -4, 1], [-26, 10, 1], [-15, 10.2, 0.8], [-8, 10.5, 0.9],
  [4, 10.2, 1], [8, 9.5, 1.1], [30, 7, 0.9], [-24, -3, 0.8],
]

export function Trees() {
  return (
    <group>
      {TREES.map(([x, z, s]) => (
        <group key={`${x},${z}`} position={[x, 0, z]} scale={s}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.16, 1, 8]} />
            <meshStandardMaterial color="#92400e" />
          </mesh>
          <mesh position={[0, 1.5, 0]} castShadow>
            <sphereGeometry args={[0.75, 16, 16]} />
            <meshStandardMaterial color="#4ade80" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function IntegrationHub() {
  const beacon = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock: c }) => {
    if (beacon.current) beacon.current.emissiveIntensity = 0.4 + (Math.sin(c.elapsedTime * 5) + 1) * 0.6
  })
  return (
    <group position={[8.5, 0, 5.5]}>
      <Box position={[0, 0.1, 0]} size={[5.2, 0.2, 4.2]} color="#e2e8f0" />
      {[-1.6, 0, 1.6].map((x) => (
        <group key={x} position={[x, 0, -0.8]}>
          <Box position={[0, 1.15, 0]} size={[1.1, 2.1, 1]} color="#1e293b" />
          {[0.5, 0.9, 1.3, 1.7].map((y) => (
            <mesh key={y} position={[0, y, 0.51]}>
              <boxGeometry args={[0.8, 0.08, 0.02]} />
              <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.8} />
            </mesh>
          ))}
        </group>
      ))}
      {/* antenna */}
      <Box position={[1.9, 1.6, 1.3]} size={[0.15, 3.2, 0.15]} color="#94a3b8" />
      <mesh position={[1.9, 3.3, 1.3]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial ref={beacon} color="#f97316" emissive="#f97316" />
      </mesh>
      <mesh position={[1.4, 2.6, 1.3]} rotation={[0, 0, -0.6]}>
        <cylinderGeometry args={[0.55, 0.1, 0.25, 20]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}
