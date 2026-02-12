import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sphere, Html, Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'

export default function Sensors({ data = [] }) {
  // Données de capteurs par défaut si non fournies
  const defaultSensors = data.length > 0 ? data : [
    { id: 1, name: 'Capteur 1', position: [-3, 1.5, 3], iaq_score: 85, temperature: 22, type: 'excellent' },
    { id: 2, name: 'Capteur 2', position: [3, 1.5, 3], iaq_score: 72, temperature: 23, type: 'good' },
    { id: 3, name: 'Capteur 3', position: [-3, 4.5, 3], iaq_score: 58, temperature: 21, type: 'medium' },
    { id: 4, name: 'Capteur 4', position: [3, 4.5, 3], iaq_score: 45, temperature: 24, type: 'poor' },
    { id: 5, name: 'Capteur 5', position: [0, 7.5, 0], iaq_score: 91, temperature: 22, type: 'excellent' },
  ]

  return (
    <group>
      {defaultSensors.map((sensor) => (
        <Sensor key={sensor.id} sensor={sensor} />
      ))}
    </group>
  )
}

function Sensor({ sensor }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)
  const [clicked, setClicked] = useState(false)

  // Animation de pulsation
  useFrame((state) => {
    if (meshRef.current) {
      const time = state.clock.getElapsedTime()
      meshRef.current.scale.setScalar(1 + Math.sin(time * 2) * 0.1)
    }
  })

  // Couleur basée sur le score IAQ
  const getColor = (score) => {
    if (score >= 80) return '#10b981' // Vert
    if (score >= 60) return '#3b82f6' // Bleu
    if (score >= 40) return '#f59e0b' // Orange
    return '#ef4444' // Rouge
  }

  const color = getColor(sensor.iaq_score || 50)

  return (
    <group position={sensor.position}>
      {/* Sphère du capteur */}
      <Sphere
        ref={meshRef}
        args={[0.3, 32, 32]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={() => setClicked(!clicked)}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.8 : 0.5}
          roughness={0.2}
          metalness={0.8}
        />
      </Sphere>

      {/* Halo lumineux */}
      <Sphere args={[0.4, 32, 32]}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? 0.3 : 0.15}
          side={THREE.BackSide}
        />
      </Sphere>

      {/* Label toujours visible */}
      <Billboard position={[0, 0.6, 0]}>
        <Text
          fontSize={0.3}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.05}
          outlineColor="#000000"
        >
          {sensor.name}
        </Text>
      </Billboard>

      {/* Info détaillée au hover */}
      {(hovered || clicked) && (
        <Html
          position={[0, 0.8, 0]}
          center
          distanceFactor={8}
          style={{
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.95)',
              color: 'white',
              padding: '12px 16px',
              borderRadius: '8px',
              border: `2px solid ${color}`,
              minWidth: '180px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              fontSize: '12px',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>
              {sensor.name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Score IAQ:</span>
                <strong style={{ color }}>{sensor.iaq_score}/100</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Température:</span>
                <strong>{sensor.temperature}°C</strong>
              </div>
              {sensor.humidity && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Humidité:</span>
                  <strong>{sensor.humidity}%</strong>
                </div>
              )}
              {sensor.co2 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>CO₂:</span>
                  <strong>{sensor.co2} ppm</strong>
                </div>
              )}
            </div>
          </div>
        </Html>
      )}

      {/* Ligne de connexion au sol */}
      <line>
        <bufferGeometry attach="geometry">
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0, 0, 0, -sensor.position[1], 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial attach="material" color={color} opacity={0.3} transparent />
      </line>
    </group>
  )
}
