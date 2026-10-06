import * as THREE from 'three';
import { OdometerDisplay } from './numerals.js';

export interface BidderSeatConfig {
  id: string;
  name: string;
  color: string;
  seatIndex: number;
}

export const BIDDER_SEATS: BidderSeatConfig[] = [
  { id: 'bidder-1', name: 'Alice (Seat 1)', color: '#f59e0b', seatIndex: 0 },
  { id: 'bidder-2', name: 'Bob (Seat 2)', color: '#10b981', seatIndex: 1 },
  { id: 'bidder-3', name: 'Claire (Seat 3)', color: '#ef4444', seatIndex: 2 },
  { id: 'bidder-4', name: 'David (Seat 4)', color: '#06b6d4', seatIndex: 3 },
  { id: 'bidder-5', name: 'Elena (Seat 5)', color: '#8b5cf6', seatIndex: 4 },
  { id: 'bidder-6', name: 'Felix (Seat 6)', color: '#ec4899', seatIndex: 5 },
];

interface ActivePulse {
  mesh: THREE.Mesh;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  progress: number;
  duration: number;
  maxRadius: number;
}

export class AuctionRoomScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public odometer: OdometerDisplay;

  // Lighting
  private spotLight: THREE.SpotLight;
  private spotTarget: THREE.Object3D;
  private ambientLight: THREE.AmbientLight;
  private lightIntensityTarget = 3.6;
  private lightColorTarget = new THREE.Color(0xffecd0);

  // Procedural lot
  private orreryGroup: THREE.Group;
  private gimbalRings: THREE.Mesh[] = [];
  private orreryCore!: THREE.Mesh;

  // Countdown ring
  private countdownRingMesh: THREE.Mesh;
  private countdownRingMaterial: THREE.MeshBasicMaterial;
  private countdownProgress = 1.0;
  private extensionFlashProgress = 0;

  // Bidder seat markers
  private seatMarkers: THREE.Group[] = [];
  private activePulses: ActivePulse[] = [];

  // Camera & motion
  private orbitAngle = 0.8;
  private baseRadius = 14;
  private cameraHeight = 7;
  private isCloseUpActive = false;
  private closeUpTimer = 0;
  private closeUpTargetPos = new THREE.Vector3();
  private reducedMotion = false;

  // Temporary reusable math objects (prevent per-frame GC allocations)
  private tempVec = new THREE.Vector3();
  private tempVec2 = new THREE.Vector3();

  // Rejection flicker
  private flickerTimer = 0;

  constructor(container: HTMLElement) {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0c0a);
    this.scene.fog = new THREE.FogExp2(0x0e0c0a, 0.035);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, this.cameraHeight, this.baseRadius);

    // 3. Renderer (capped pixel ratio for 60fps)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 4. Lights
    this.ambientLight = new THREE.AmbientLight(0x28201a, 0.9);
    this.scene.add(this.ambientLight);

    this.spotLight = new THREE.SpotLight(0xffecd0, 3.6, 28, Math.PI / 5, 0.55, 1.2);
    this.spotLight.position.set(0, 15, 0);
    this.spotLight.castShadow = true;
    this.spotLight.shadow.mapSize.width = 1024;
    this.spotLight.shadow.mapSize.height = 1024;
    this.spotLight.shadow.bias = -0.0001;

    this.spotTarget = new THREE.Object3D();
    this.spotTarget.position.set(0, 1.5, 0);
    this.scene.add(this.spotTarget);
    this.spotLight.target = this.spotTarget;
    this.scene.add(this.spotLight);

    // 5. Room Architecture
    this.buildRoom();

    // 6. Pedestal
    this.buildPedestal();

    // 7. Procedural Lot (Celestial Orrery)
    this.orreryGroup = this.buildOrrery();
    this.scene.add(this.orreryGroup);

    // 8. 3D Numerals Odometer
    this.odometer = new OdometerDisplay();
    this.odometer.group.position.set(0, 4.4, 0);
    this.scene.add(this.odometer.group);

    // 9. Countdown Ring around pedestal base
    const ringGeom = new THREE.RingGeometry(2.3, 2.45, 64);
    this.countdownRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.countdownRingMesh = new THREE.Mesh(ringGeom, this.countdownRingMaterial);
    this.countdownRingMesh.rotation.x = -Math.PI / 2;
    this.countdownRingMesh.position.y = 0.03;
    this.scene.add(this.countdownRingMesh);

    // 10. Bidder Seats in Amphitheater Circle
    this.buildBidderSeats();

    // Reduced motion preference
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Window resize handler
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private buildRoom(): void {
    // Parquet Floor with dark mahogany tones
    const floorGeom = new THREE.CylinderGeometry(18, 18, 0.2, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x181411,
      roughness: 0.85,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Outer Amphitheater Rim
    const rimGeom = new THREE.TorusGeometry(18, 0.4, 16, 64);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x241d17,
      roughness: 0.6,
      metalness: 0.3,
    });
    const rim = new THREE.Mesh(rimGeom, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    this.scene.add(rim);
  }

  private buildPedestal(): void {
    const pedestalGroup = new THREE.Group();

    // Base plinth
    const baseGeom = new THREE.CylinderGeometry(2.2, 2.4, 0.4, 32);
    const marbleMat = new THREE.MeshStandardMaterial({
      color: 0x1f1a16,
      roughness: 0.4,
      metalness: 0.2,
    });
    const base = new THREE.Mesh(baseGeom, marbleMat);
    base.position.y = 0.2;
    base.castShadow = true;
    base.receiveShadow = true;
    pedestalGroup.add(base);

    // Main column
    const colGeom = new THREE.CylinderGeometry(1.6, 1.8, 1.8, 32);
    const col = new THREE.Mesh(colGeom, marbleMat);
    col.position.y = 1.3;
    col.castShadow = true;
    col.receiveShadow = true;
    pedestalGroup.add(col);

    // Top capital with gold trim
    const capGeom = new THREE.CylinderGeometry(2.0, 1.7, 0.3, 32);
    const cap = new THREE.Mesh(capGeom, marbleMat);
    cap.position.y = 2.35;
    cap.castShadow = true;
    cap.receiveShadow = true;
    pedestalGroup.add(cap);

    // Gold trim ring
    const trimGeom = new THREE.TorusGeometry(1.85, 0.06, 16, 48);
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.85,
      roughness: 0.3,
    });
    const trim = new THREE.Mesh(trimGeom, goldMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 2.45;
    pedestalGroup.add(trim);

    this.scene.add(pedestalGroup);
  }

  private buildOrrery(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 3.1, 0);

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.9,
      roughness: 0.2,
      wireframe: false,
    });

    // 3 concentric gimbal rings rotating on distinct axes
    const radii = [0.85, 0.65, 0.48];
    for (const r of radii) {
      const ringGeom = new THREE.TorusGeometry(r, 0.025, 12, 48);
      const ring = new THREE.Mesh(ringGeom, brassMat);
      ring.castShadow = true;
      group.add(ring);
      this.gimbalRings.push(ring);
    }

    // Central faceted gemstone core
    const coreGeom = new THREE.OctahedronGeometry(0.24, 0);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffdd88,
      metalness: 0.95,
      roughness: 0.1,
      emissive: 0x996611,
      emissiveIntensity: 0.6,
    });
    this.orreryCore = new THREE.Mesh(coreGeom, coreMat);
    this.orreryCore.castShadow = true;
    group.add(this.orreryCore);

    return group;
  }

  private buildBidderSeats(): void {
    const seatRadius = 11.5;
    const numSeats = BIDDER_SEATS.length;

    for (let i = 0; i < numSeats; i++) {
      const seat = BIDDER_SEATS[i];
      const angle = (i / numSeats) * Math.PI * 2;
      const x = Math.cos(angle) * seatRadius;
      const z = Math.sin(angle) * seatRadius;

      const seatGroup = new THREE.Group();
      seatGroup.position.set(x, 0, z);

      // Low pedestal podium for bidder
      const podiumGeom = new THREE.CylinderGeometry(0.7, 0.8, 0.25, 24);
      const podiumMat = new THREE.MeshStandardMaterial({
        color: 0x1f1914,
        roughness: 0.7,
        metalness: 0.3,
      });
      const podium = new THREE.Mesh(podiumGeom, podiumMat);
      podium.position.y = 0.12;
      podium.receiveShadow = true;
      seatGroup.add(podium);

      // Colored beacon gem on the podium
      const gemGeom = new THREE.CylinderGeometry(0.25, 0.25, 0.1, 16);
      const gemMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(seat.color),
        emissive: new THREE.Color(seat.color),
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });
      const gem = new THREE.Mesh(gemGeom, gemMat);
      gem.position.y = 0.3;
      seatGroup.add(gem);

      this.seatMarkers.push(seatGroup);
      this.scene.add(seatGroup);
    }
  }

  public getSeatPosition(seatIndex: number): THREE.Vector3 {
    if (this.seatMarkers[seatIndex]) {
      return this.seatMarkers[seatIndex].position.clone();
    }
    return new THREE.Vector3(0, 0, 0);
  }

  public triggerAcceptedBid(seatIndex: number, bidderColorHex: string): void {
    const seatPos = this.getSeatPosition(seatIndex);

    // Create expanding pulse ring starting from bidder seat
    const pulseGeom = new THREE.RingGeometry(0.1, 0.5, 32);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(bidderColorHex),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const pulseMesh = new THREE.Mesh(pulseGeom, pulseMat);
    pulseMesh.rotation.x = -Math.PI / 2;
    pulseMesh.position.set(seatPos.x, 0.05, seatPos.z);
    this.scene.add(pulseMesh);

    this.activePulses.push({
      mesh: pulseMesh,
      startPos: seatPos.clone(),
      targetPos: new THREE.Vector3(0, 0, 0),
      progress: 0,
      duration: 1.6,
      maxRadius: 12.0,
    });

    // Camera ease: orient close-up toward the lot & winner seat (unless reduced motion)
    if (!this.reducedMotion) {
      this.isCloseUpActive = true;
      this.closeUpTimer = 2.4;
      // Interpolate vantage position slightly closer and aligned with bidder angle
      const angle = Math.atan2(seatPos.z, seatPos.x);
      this.closeUpTargetPos.set(
        Math.cos(angle + 0.3) * 8.5,
        4.8,
        Math.sin(angle + 0.3) * 8.5
      );
    }
  }

  public triggerRejectedBidFeedback(): void {
    // Brief dim flicker on spotlight to signal rejection
    this.flickerTimer = 0.35;
    this.spotLight.intensity = 0.5;
  }

  public triggerAntiSnipeExtension(): void {
    // Visually push countdown ring out
    this.extensionFlashProgress = 1.0;
  }

  public setCountdown(remainingMs: number, totalDurationMs = 300000): void {
    const ratio = Math.max(0, Math.min(1, remainingMs / totalDurationMs));
    this.countdownProgress = ratio;
  }

  public setConnectedState(connected: boolean): void {
    if (connected) {
      this.lightColorTarget.setHex(0xffecd0);
      this.lightIntensityTarget = 3.6;
      this.odometer.setDimState(false);
    } else {
      // Diegetic connection state: lights drop to dim amber
      this.lightColorTarget.setHex(0x704812);
      this.lightIntensityTarget = 0.35;
      this.odometer.setDimState(true);
    }
  }

  public toggleMotion(): boolean {
    this.reducedMotion = !this.reducedMotion;
    return !this.reducedMotion;
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public render(delta: number): void {
    // 1. Rotate procedural lot rings
    if (this.gimbalRings.length >= 3) {
      this.gimbalRings[0].rotation.x += delta * 0.4;
      this.gimbalRings[0].rotation.y += delta * 0.2;
      this.gimbalRings[1].rotation.y += delta * 0.5;
      this.gimbalRings[1].rotation.z += delta * 0.3;
      this.gimbalRings[2].rotation.z += delta * 0.6;
      this.gimbalRings[2].rotation.x += delta * 0.25;
    }
    if (this.orreryCore) {
      this.orreryCore.rotation.y += delta * 0.8;
    }

    // 2. Light transition easing
    this.spotLight.color.lerp(this.lightColorTarget, delta * 3.0);
    if (this.flickerTimer > 0) {
      this.flickerTimer -= delta;
      if (this.flickerTimer <= 0) {
        this.spotLight.intensity = this.lightIntensityTarget;
      }
    } else {
      this.spotLight.intensity = THREE.MathUtils.lerp(
        this.spotLight.intensity,
        this.lightIntensityTarget,
        delta * 3.0
      );
    }

    // 3. Countdown ring animation
    // Base radius scales from 1.2 to 2.4 based on countdown progress
    let targetRadius = 1.2 + this.countdownProgress * 1.3;
    if (this.extensionFlashProgress > 0) {
      this.extensionFlashProgress -= delta * 1.5;
      if (this.extensionFlashProgress < 0) this.extensionFlashProgress = 0;
      // Push out visibly on extension
      targetRadius += Math.sin(this.extensionFlashProgress * Math.PI) * 0.8;
    }
    this.countdownRingMesh.scale.set(targetRadius, targetRadius, targetRadius);

    // 4. Update 3D numerals odometer
    this.odometer.update(delta);
    // Face the numerals directly toward camera on the horizontal plane
    this.tempVec.set(this.camera.position.x, 4.4, this.camera.position.z);
    this.odometer.group.lookAt(this.tempVec);

    // 5. Active bid pulses
    for (let i = this.activePulses.length - 1; i >= 0; i--) {
      const pulse = this.activePulses[i];
      pulse.progress += delta / pulse.duration;
      if (pulse.progress >= 1) {
        this.scene.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        (pulse.mesh.material as THREE.Material).dispose();
        this.activePulses.splice(i, 1);
        continue;
      }

      // Move toward center and expand
      const t = pulse.progress;
      this.tempVec.lerpVectors(pulse.startPos, pulse.targetPos, t * 0.7);
      pulse.mesh.position.set(this.tempVec.x, 0.04, this.tempVec.z);

      const r = 0.5 + t * pulse.maxRadius;
      pulse.mesh.scale.set(r, r, 1);
      (pulse.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
    }

    // 6. Camera Orbit & Ease
    if (this.reducedMotion) {
      // Static viewpoint for reduced motion
      this.camera.position.set(0, 6.5, 14.5);
      this.camera.lookAt(0, 2.5, 0);
    } else {
      if (this.isCloseUpActive) {
        this.closeUpTimer -= delta;
        this.camera.position.lerp(this.closeUpTargetPos, delta * 2.8);
        this.spotTarget.position.lerp(this.tempVec.set(0, 2.5, 0), delta * 2.5);
        this.camera.lookAt(this.spotTarget.position);

        if (this.closeUpTimer <= 0) {
          this.isCloseUpActive = false;
        }
      } else {
        // Slow idle orbit
        this.orbitAngle += delta * 0.08;
        const targetX = Math.cos(this.orbitAngle) * this.baseRadius;
        const targetZ = Math.sin(this.orbitAngle) * this.baseRadius;
        this.tempVec2.set(targetX, this.cameraHeight, targetZ);
        this.camera.position.lerp(this.tempVec2, delta * 1.5);
        this.camera.lookAt(0, 2.3, 0);
      }
    }

    // 7. Render frame
    this.renderer.render(this.scene, this.camera);
  }
}
