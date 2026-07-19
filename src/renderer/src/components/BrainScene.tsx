import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { Float, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { AIProvider } from '@shared/events'

interface BrainSceneProps {
  activity: number
  toolPulse: number
  errorPulse: number
  provider: AIProvider
  phase: string
}

const vertexShader = `
  uniform float uTime;
  uniform float uActivity;
  uniform float uTool;
  uniform float uError;
  attribute float aSeed;
  attribute float aRegion;
  varying float vGlow;
  varying float vRegion;
  varying float vError;

  void main() {
    vec3 p = position;
    float ripple = sin(uTime * (1.3 + aSeed * 1.8) + aSeed * 16.0 + p.y * 2.4);
    float wave = sin(uTime * 2.1 - length(p) * 4.5 + aSeed * 9.0);
    float neural = smoothstep(0.36, 1.0, wave * 0.5 + 0.5) * uActivity;
    float toolWave = smoothstep(0.2, 1.0, sin(uTime * 7.0 + p.x * 4.0 + aSeed * 11.0) * 0.5 + 0.5) * uTool;
    vec3 normalish = normalize(p + vec3(0.001));
    p += normalish * (ripple * 0.018 + neural * 0.055 + toolWave * 0.04);

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float sizePulse = 1.0 + neural * 1.7 + toolWave * 1.2 + uError * 0.8;
    gl_PointSize = (2.1 + aSeed * 2.4) * sizePulse * (8.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    vGlow = clamp(0.14 + neural * 0.9 + toolWave * 0.75 + ripple * 0.08, 0.0, 1.0);
    vRegion = aRegion;
    vError = uError;
  }
`

const fragmentShader = `
  uniform vec3 uColor;
  varying float vGlow;
  varying float vRegion;
  varying float vError;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float distanceToCenter = length(centered);
    if (distanceToCenter > 0.5) discard;

    float core = smoothstep(0.18, 0.0, distanceToCenter);
    float halo = smoothstep(0.5, 0.04, distanceToCenter);
    vec3 regionTint = mix(uColor, vec3(0.62, 0.38, 1.0), vRegion * 0.22);
    vec3 color = mix(regionTint * 0.38, regionTint * 1.75, vGlow);
    color = mix(color, vec3(1.0, 0.18, 0.12), vError * 0.75);
    float alpha = halo * (0.24 + vGlow * 0.78) + core * 0.35;
    gl_FragColor = vec4(color, alpha);
  }
`

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function createBrainGeometry(count = 4200): { points: THREE.BufferGeometry; lines: THREE.BufferGeometry } {
  const random = seededRandom(906_241)
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const regions = new Float32Array(count)
  let accepted = 0

  while (accepted < count) {
    const x = (random() * 2 - 1) * 2.25
    const y = (random() * 2 - 1) * 1.58
    const z = (random() * 2 - 1) * 1.42
    const hemisphereCenter = x < 0 ? -0.32 : 0.32
    const dx = (x - hemisphereCenter) / 1.86
    const dy = (y + 0.02) / 1.48
    const dz = z / 1.25
    const ellipsoid = dx * dx + dy * dy + dz * dz
    const fissure = Math.abs(x) < 0.075 && y > -0.92 && z > -0.88
    const lowerCut = y < -1.22 && Math.abs(x) > 1.05
    const frontalTaper = x > 1.75 && Math.abs(y) > 1.0

    if (ellipsoid > 1 || fissure || lowerCut || frontalTaper) continue

    const index = accepted * 3
    positions[index] = x
    positions[index + 1] = y
    positions[index + 2] = z
    seeds[accepted] = random()
    regions[accepted] = Math.min(1, Math.max(0, (y + 1.5) / 3 + z * 0.06))
    accepted += 1
  }

  const points = new THREE.BufferGeometry()
  points.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  points.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  points.setAttribute('aRegion', new THREE.BufferAttribute(regions, 1))

  const edgeCount = 1450
  const linePositions = new Float32Array(edgeCount * 6)
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const a = Math.floor(random() * count)
    const aOffset = a * 3
    let best = Math.floor(random() * count)
    let bestDistance = Number.POSITIVE_INFINITY

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = Math.floor(random() * count)
      const cOffset = candidate * 3
      const dx = positions[aOffset] - positions[cOffset]
      const dy = positions[aOffset + 1] - positions[cOffset + 1]
      const dz = positions[aOffset + 2] - positions[cOffset + 2]
      const distance = dx * dx + dy * dy + dz * dz
      if (distance < bestDistance && distance > 0.006) {
        bestDistance = distance
        best = candidate
      }
    }

    const bOffset = best * 3
    const target = edge * 6
    linePositions[target] = positions[aOffset]
    linePositions[target + 1] = positions[aOffset + 1]
    linePositions[target + 2] = positions[aOffset + 2]
    linePositions[target + 3] = positions[bOffset]
    linePositions[target + 4] = positions[bOffset + 1]
    linePositions[target + 5] = positions[bOffset + 2]
  }

  const lines = new THREE.BufferGeometry()
  lines.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
  return { points, lines }
}

const providerColors: Record<AIProvider, string> = {
  demo: '#66e7ff',
  'claude-code': '#c892ff',
  codex: '#7df6ac',
  openai: '#edf6ff'
}

function NeuralBrain({ activity, toolPulse, errorPulse, provider, phase }: BrainSceneProps): React.JSX.Element {
  const group = useRef<THREE.Group>(null)
  const pointMaterial = useRef<THREE.ShaderMaterial>(null)
  const lineMaterial = useRef<THREE.LineBasicMaterial>(null)
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const geometry = useMemo(() => createBrainGeometry(), [])
  const targetColor = useMemo(() => new THREE.Color(providerColors[provider]), [provider])

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime
    if (group.current) {
      group.current.rotation.y += delta * (0.07 + activity * 0.035)
      group.current.rotation.x = Math.sin(time * 0.18) * 0.055
    }
    if (pointMaterial.current) {
      pointMaterial.current.uniforms.uTime.value = time
      pointMaterial.current.uniforms.uActivity.value = activity
      pointMaterial.current.uniforms.uTool.value = toolPulse
      pointMaterial.current.uniforms.uError.value = errorPulse
      ;(pointMaterial.current.uniforms.uColor.value as THREE.Color).lerp(targetColor, 0.08)
    }
    if (lineMaterial.current) {
      lineMaterial.current.opacity = 0.045 + activity * 0.105 + toolPulse * 0.06
      lineMaterial.current.color.lerp(targetColor, 0.06)
    }
    if (ringMaterial.current) {
      ringMaterial.current.opacity = 0.05 + toolPulse * 0.22 + (phase === 'memory' ? 0.18 : 0)
      ringMaterial.current.color.lerp(targetColor, 0.07)
    }
  })

  return (
    <Float speed={0.8} rotationIntensity={0.08} floatIntensity={0.12}>
      <group ref={group} scale={1.1}>
        <lineSegments geometry={geometry.lines}>
          <lineBasicMaterial
            ref={lineMaterial}
            color={providerColors[provider]}
            transparent
            opacity={0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
        <points geometry={geometry.points} frustumCulled={false}>
          <shaderMaterial
            ref={pointMaterial}
            uniforms={{
              uTime: { value: 0 },
              uActivity: { value: activity },
              uTool: { value: toolPulse },
              uError: { value: errorPulse },
              uColor: { value: new THREE.Color(providerColors[provider]) }
            }}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        <mesh rotation={[Math.PI / 2, 0, 0]} scale={[2.7, 2.15, 1]}>
          <torusGeometry args={[1, 0.006, 8, 180]} />
          <meshBasicMaterial
            ref={ringMaterial}
            color={providerColors[provider]}
            transparent
            opacity={0.08}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </Float>
  )
}

export function BrainScene(props: BrainSceneProps): React.JSX.Element {
  return (
    <div className="brain-canvas" aria-label="Decorative neural activity visualization">
      <Canvas dpr={[1, 1.7]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
        <PerspectiveCamera makeDefault position={[0, 0.15, 7.2]} fov={42} />
        <ambientLight intensity={0.12} />
        <pointLight position={[3, 3, 4]} intensity={0.85} color={providerColors[props.provider]} />
        <NeuralBrain {...props} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.65} luminanceThreshold={0.08} luminanceSmoothing={0.55} mipmapBlur />
          <Noise opacity={0.018} />
          <Vignette eskil={false} offset={0.18} darkness={0.88} />
        </EffectComposer>
      </Canvas>
      <div className="brain-grid" />
      <div className="brain-scanline" />
    </div>
  )
}
