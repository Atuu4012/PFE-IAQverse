import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Grid, Environment } from '@react-three/drei'
import { Suspense } from 'react'
import Building from './Building'
import Sensors from './Sensors'

export default function Scene3D({ buildingData, sensorsData }) {
  return (
    <Canvas shadows>
      <Suspense fallback={null}>
        {/* Caméra */}
        <PerspectiveCamera makeDefault position={[10, 10, 10]} fov={50} />
        
        {/* Contrôles */}
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={5}
          maxDistance={50}
          maxPolarAngle={Math.PI / 2}
        />
        
        {/* Lumières */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={1}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <pointLight position={[-10, 10, -10]} intensity={0.5} />
        
        {/* Environnement */}
        <Environment preset="city" />
        
        {/* Grille */}
        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#6b7280"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#3b82f6"
          fadeDistance={30}
          fadeStrength={1}
          followCamera={false}
        />
        
        {/* Contenu 3D */}
        <Building data={buildingData} />
        <Sensors data={sensorsData} />
      </Suspense>
    </Canvas>
  )
}
