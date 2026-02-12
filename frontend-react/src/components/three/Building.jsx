import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Box, Text } from '@react-three/drei'

export default function Building({ data = {} }) {
  const buildingRef = useRef()

  // Paramètres par défaut du bâtiment
  const floors = data.floors || 3
  const floorHeight = 3
  const width = data.width || 10
  const depth = data.depth || 10

  return (
    <group ref={buildingRef} position={[0, 0, 0]}>
      {/* Sol/Base */}
      <mesh receiveShadow position={[0, 0.1, 0]}>
        <boxGeometry args={[width + 2, 0.2, depth + 2]} />
        <meshStandardMaterial color="#4b5563" />
      </mesh>

      {/* Étages */}
      {Array.from({ length: floors }).map((_, i) => (
        <group key={i} position={[0, i * floorHeight + floorHeight / 2, 0]}>
          {/* Murs */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[width, floorHeight, depth]} />
            <meshStandardMaterial
              color="#e5e7eb"
              transparent
              opacity={0.8}
              roughness={0.3}
              metalness={0.1}
            />
          </mesh>

          {/* Contours */}
          <lineSegments>
            <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(width, floorHeight, depth)]} />
            <lineBasicMaterial attach="material" color="#1f2937" linewidth={2} />
          </lineSegments>

          {/* Label étage */}
          <Text
            position={[0, floorHeight / 2 + 0.3, depth / 2 + 0.1]}
            fontSize={0.5}
            color="#1f2937"
            anchorX="center"
            anchorY="middle"
          >
            Étage {i + 1}
          </Text>

          {/* Fenêtres */}
          {createWindows(width, depth, floorHeight, i)}
        </group>
      ))}

      {/* Toit */}
      <mesh
        castShadow
        receiveShadow
        position={[0, floors * floorHeight + 0.3, 0]}
      >
        <boxGeometry args={[width + 0.5, 0.5, depth + 0.5]} />
        <meshStandardMaterial color="#374151" roughness={0.8} />
      </mesh>
    </group>
  )
}

// Fonction helper pour créer les fenêtres
function createWindows(width, depth, height, floor) {
  const windows = []
  const windowSize = 0.8
  const spacing = 2
  const windowsPerSide = Math.floor(width / spacing)

  // Fenêtres face avant et arrière
  for (let i = 0; i < windowsPerSide; i++) {
    const x = -width / 2 + spacing / 2 + i * spacing
    
    // Face avant
    windows.push(
      <mesh key={`front-${i}`} position={[x, 0, depth / 2 + 0.01]}>
        <planeGeometry args={[windowSize, windowSize]} />
        <meshStandardMaterial
          color="#60a5fa"
          transparent
          opacity={0.6}
          emissive="#3b82f6"
          emissiveIntensity={0.2}
        />
      </mesh>
    )

    // Face arrière
    windows.push(
      <mesh key={`back-${i}`} position={[x, 0, -depth / 2 - 0.01]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[windowSize, windowSize]} />
        <meshStandardMaterial
          color="#60a5fa"
          transparent
          opacity={0.6}
          emissive="#3b82f6"
          emissiveIntensity={0.2}
        />
      </mesh>
    )
  }

  return windows
}

// Import THREE pour EdgeGeometry
import * as THREE from 'three'
