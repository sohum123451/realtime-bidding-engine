import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  public controls: OrbitControls;
  public odometer: OdometerDisplay;

  // Theatrical Studio Lighting
  private keySpotLight: THREE.SpotLight;
  private spotTarget: THREE.Object3D;
  private ambientLight: THREE.AmbientLight;
  private rimLight1: THREE.DirectionalLight;
  private rimLight2: THREE.DirectionalLight;
  private pedestalUnderLight: THREE.PointLight;
  private lightIntensityTarget = 4.2;
  private lightColorTarget = new THREE.Color(0xfff4e0);

  // Procedural Lot (Kinetic Orrery)
  private orreryGroup: THREE.Group;
  private gimbalRings: THREE.Mesh[] = [];
  private orreryCore!: THREE.Mesh;
  private planets: THREE.Mesh[] = [];

  // Countdown Ring
  private countdownRingMesh: THREE.Mesh;
  private countdownRingMaterial: THREE.MeshBasicMaterial;
  private countdownProgress = 1.0;
  private extensionFlashProgress = 0;

  // Interactive Bidder Stations
  public seatMarkers: THREE.Group[] = [];
  private seatBeacons: THREE.Mesh[] = [];
  private activePulses: ActivePulse[] = [];
  public activeSeatIndex = 0;

  // Camera & Interaction
  private isCloseUpActive = false;
  private closeUpTimer = 0;
  private closeUpTargetPos = new THREE.Vector3();
  private reducedMotion = false;
  public onSeatClicked?: (seatIndex: number) => void;

  // Raycasting for 3D clicks
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Temporary math objects (zero per-frame allocations)
  private tempVec = new THREE.Vector3();

  // Rejection flicker
  private flickerTimer = 0;

  constructor(container: HTMLElement) {
    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0907);
    this.scene.fog = new THREE.FogExp2(0x0c0907, 0.03);

    // 2. Camera setup
    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      120
    );
    this.camera.position.set(0, 7.5, 15.5);

    // 3. High performance WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls (allows mouse rotation, pan, zoom with smooth inertia)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 6.0;
    this.controls.maxDistance = 24.0;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // don't go below floor
    this.controls.target.set(0, 2.6, 0);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.6;

    // 5. Rich Multi-Point Studio Lighting
    this.ambientLight = new THREE.AmbientLight(0x382c20, 1.2);
    this.scene.add(this.ambientLight);

    // Key overhead spotlight
    this.keySpotLight = new THREE.SpotLight(0xfff4e0, 4.2, 32, Math.PI / 4.5, 0.45, 1.1);
    this.keySpotLight.position.set(0, 16, 0);
    this.keySpotLight.castShadow = true;
    this.keySpotLight.shadow.mapSize.width = 1024;
    this.keySpotLight.shadow.mapSize.height = 1024;
    this.keySpotLight.shadow.bias = -0.0001;

    this.spotTarget = new THREE.Object3D();
    this.spotTarget.position.set(0, 2.0, 0);
    this.scene.add(this.spotTarget);
    this.keySpotLight.target = this.spotTarget;
    this.scene.add(this.keySpotLight);

    // Warm angled rim lights to sculpt specular highlights
    this.rimLight1 = new THREE.DirectionalLight(0xd4af37, 1.6);
    this.rimLight1.position.set(12, 10, 8);
    this.scene.add(this.rimLight1);

    this.rimLight2 = new THREE.DirectionalLight(0x8c6d48, 1.2);
    this.rimLight2.position.set(-10, 8, -8);
    this.scene.add(this.rimLight2);

    // Uplight under pedestal capital
    this.pedestalUnderLight = new THREE.PointLight(0xffdf80, 1.5, 4.5);
    this.pedestalUnderLight.position.set(0, 2.7, 0);
    this.scene.add(this.pedestalUnderLight);

    // 6. Build Environment
    this.buildRoom();
    this.buildPedestal();

    // 7. Procedural Lot (Orrery)
    this.orreryGroup = this.buildOrrery();
    this.scene.add(this.orreryGroup);

    // 8. 3D Odometer Numerals
    this.odometer = new OdometerDisplay();
    this.odometer.group.position.set(0, 4.8, 0);
    this.scene.add(this.odometer.group);

    // 9. Countdown Ring around pedestal
    const ringGeom = new THREE.RingGeometry(2.35, 2.55, 64);
    this.countdownRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xe6b840,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.countdownRingMesh = new THREE.Mesh(ringGeom, this.countdownRingMaterial);
    this.countdownRingMesh.rotation.x = -Math.PI / 2;
    this.countdownRingMesh.position.y = 0.04;
    this.scene.add(this.countdownRingMesh);

    // 10. Bidder Stations
    this.buildBidderSeats();

    // Reduced motion preference
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) {
      this.controls.autoRotate = false;
    }

    // Event listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
  }

  private buildRoom(): void {
    // Polished dark mahogany/marble floor with subtle specular sheen
    const floorGeom = new THREE.CylinderGeometry(20, 20, 0.2, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x15110d,
      roughness: 0.35,
      metalness: 0.35,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Inlay decorative brass rings on floor
    const inlayGeom1 = new THREE.RingGeometry(5.8, 5.86, 64);
    const inlayGeom2 = new THREE.RingGeometry(11.2, 11.28, 64);
    const inlayMat = new THREE.MeshStandardMaterial({
      color: 0xb8860b,
      metalness: 0.85,
      roughness: 0.3,
    });

    const inlay1 = new THREE.Mesh(inlayGeom1, inlayMat);
    inlay1.rotation.x = -Math.PI / 2;
    inlay1.position.y = 0.02;
    this.scene.add(inlay1);

    const inlay2 = new THREE.Mesh(inlayGeom2, inlayMat);
    inlay2.rotation.x = -Math.PI / 2;
    inlay2.position.y = 0.02;
    this.scene.add(inlay2);
  }

  private buildPedestal(): void {
    const pedestalGroup = new THREE.Group();

    // Stepped plinth base
    const base1Geom = new THREE.CylinderGeometry(2.4, 2.5, 0.25, 36);
    const base2Geom = new THREE.CylinderGeometry(2.1, 2.3, 0.3, 36);
    const marbleMat = new THREE.MeshStandardMaterial({
      color: 0x221a14,
      roughness: 0.3,
      metalness: 0.2,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.9,
      roughness: 0.25,
    });

    const b1 = new THREE.Mesh(base1Geom, marbleMat);
    b1.position.y = 0.125;
    b1.castShadow = true;
    b1.receiveShadow = true;
    pedestalGroup.add(b1);

    const b2 = new THREE.Mesh(base2Geom, marbleMat);
    b2.position.y = 0.4;
    b2.castShadow = true;
    b2.receiveShadow = true;
    pedestalGroup.add(b2);

    // Fluted central column
    const colGeom = new THREE.CylinderGeometry(1.65, 1.8, 1.8, 36);
    const col = new THREE.Mesh(colGeom, marbleMat);
    col.position.y = 1.45;
    col.castShadow = true;
    col.receiveShadow = true;
    pedestalGroup.add(col);

    // Decorative vertical fluting ribs
    const numRibs = 18;
    for (let i = 0; i < numRibs; i++) {
      const angle = (i / numRibs) * Math.PI * 2;
      const ribGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.7, 8);
      const rib = new THREE.Mesh(ribGeom, brassMat);
      rib.position.set(Math.cos(angle) * 1.74, 1.45, Math.sin(angle) * 1.74);
      rib.castShadow = true;
      pedestalGroup.add(rib);
    }

    // Capital & top moulding with gold trim
    const capGeom = new THREE.CylinderGeometry(2.1, 1.7, 0.35, 36);
    const cap = new THREE.Mesh(capGeom, marbleMat);
    cap.position.y = 2.45;
    cap.castShadow = true;
    cap.receiveShadow = true;
    pedestalGroup.add(cap);

    const goldRing = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.06, 16, 48), brassMat);
    goldRing.rotation.x = Math.PI / 2;
    goldRing.position.y = 2.62;
    pedestalGroup.add(goldRing);

    this.scene.add(pedestalGroup);
  }

  private buildOrrery(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 3.25, 0);

    const polishedGold = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.95,
      roughness: 0.12,
    });

    // 1. Double gimbal rings with brass depth
    const radii = [0.95, 0.72, 0.52];
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 16, 54), polishedGold);
      ring.castShadow = true;
      group.add(ring);
      this.gimbalRings.push(ring);
    }

    // 2. Central radiant sun core
    const coreGeom = new THREE.OctahedronGeometry(0.28, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffec99,
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0xd49b20,
      emissiveIntensity: 0.85,
    });
    this.orreryCore = new THREE.Mesh(coreGeom, coreMat);
    this.orreryCore.castShadow = true;
    group.add(this.orreryCore);

    // 3. Orbiting planetary satellites on wire arms
    const planetColors = [0xef4444, 0x10b981, 0x3b82f6];
    const planetDistances = [0.42, 0.65, 0.88];
    for (let i = 0; i < 3; i++) {
      const planetMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 16),
        new THREE.MeshStandardMaterial({
          color: planetColors[i],
          metalness: 0.8,
          roughness: 0.2,
          emissive: planetColors[i],
          emissiveIntensity: 0.4,
        })
      );
      planetMesh.castShadow = true;
      planetMesh.userData = { distance: planetDistances[i], speed: 1.2 - i * 0.35, angle: (i * Math.PI) / 1.5 };
      group.add(planetMesh);
      this.planets.push(planetMesh);
    }

    return group;
  }

  private buildBidderSeats(): void {
    const seatRadius = 11.2;
    const numSeats = BIDDER_SEATS.length;

    for (let i = 0; i < numSeats; i++) {
      const seat = BIDDER_SEATS[i];
      const angle = (i / numSeats) * Math.PI * 2;
      const x = Math.cos(angle) * seatRadius;
      const z = Math.sin(angle) * seatRadius;

      const seatGroup = new THREE.Group();
      seatGroup.position.set(x, 0, z);
      seatGroup.userData = { seatIndex: i, bidderId: seat.id };

      // Mahogany auction station podium
      const podiumGeom = new THREE.CylinderGeometry(0.75, 0.9, 0.45, 24);
      const podiumMat = new THREE.MeshStandardMaterial({
        color: 0x1d1712,
        roughness: 0.5,
        metalness: 0.3,
      });
      const podium = new THREE.Mesh(podiumGeom, podiumMat);
      podium.position.y = 0.225;
      podium.receiveShadow = true;
      podium.castShadow = true;
      seatGroup.add(podium);

      // Gold trim rim on podium
      const trimMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.76, 0.03, 12, 32),
        new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })
      );
      trimMesh.rotation.x = Math.PI / 2;
      trimMesh.position.y = 0.45;
      seatGroup.add(trimMesh);

      // Illuminated crystal prism beacon
      const beaconGeom = new THREE.ConeGeometry(0.24, 0.65, 6);
      const beaconMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(seat.color),
        emissive: new THREE.Color(seat.color),
        emissiveIntensity: 0.9,
        roughness: 0.15,
        metalness: 0.5,
      });
      const beacon = new THREE.Mesh(beaconGeom, beaconMat);
      beacon.position.y = 0.78;
      beacon.castShadow = true;
      seatGroup.add(beacon);
      this.seatBeacons.push(beacon);

      this.seatMarkers.push(seatGroup);
      this.scene.add(seatGroup);
    }
  }

  public setActiveSeat(seatIndex: number): void {
    this.activeSeatIndex = seatIndex;
    for (let i = 0; i < this.seatBeacons.length; i++) {
      const beacon = this.seatBeacons[i];
      const mat = beacon.material as THREE.MeshStandardMaterial;
      if (i === seatIndex) {
        mat.emissiveIntensity = 2.2;
        beacon.scale.set(1.25, 1.25, 1.25);
      } else {
        mat.emissiveIntensity = 0.65;
        beacon.scale.set(1.0, 1.0, 1.0);
      }
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

    // Expanding shockwave pulse ring
    const pulseGeom = new THREE.RingGeometry(0.2, 0.65, 36);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(bidderColorHex),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
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
      duration: 1.5,
      maxRadius: 13.0,
    });

    // Camera ease: smooth cinematic vantage toward winner seat and lot
    if (!this.reducedMotion) {
      this.isCloseUpActive = true;
      this.closeUpTimer = 2.2;
      const angle = Math.atan2(seatPos.z, seatPos.x);
      this.closeUpTargetPos.set(
        Math.cos(angle + 0.25) * 9.2,
        5.2,
        Math.sin(angle + 0.25) * 9.2
      );
    }
  }

  public triggerRejectedBidFeedback(): void {
    this.flickerTimer = 0.4;
    this.keySpotLight.intensity = 0.6;
    this.pedestalUnderLight.intensity = 0.3;
  }

  public triggerAntiSnipeExtension(): void {
    this.extensionFlashProgress = 1.0;
  }

  public setCountdown(remainingMs: number, totalDurationMs = 900000): void {
    const ratio = Math.max(0, Math.min(1, remainingMs / totalDurationMs));
    this.countdownProgress = ratio;
  }

  public setConnectedState(connected: boolean): void {
    if (connected) {
      this.lightColorTarget.setHex(0xfff4e0);
      this.lightIntensityTarget = 4.2;
      this.odometer.setDimState(false);
    } else {
      // Diegetic amber twilight drop
      this.lightColorTarget.setHex(0x754815);
      this.lightIntensityTarget = 0.45;
      this.odometer.setDimState(true);
    }
  }

  public toggleMotion(): boolean {
    this.reducedMotion = !this.reducedMotion;
    this.controls.autoRotate = !this.reducedMotion;
    return !this.reducedMotion;
  }

  private onPointerDown(event: PointerEvent): void {
    // Raycast on 3D seat podiums so user can click seats directly in 3D
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && obj !== this.scene) {
        if (obj.userData && typeof obj.userData.seatIndex === 'number') {
          if (this.onSeatClicked) {
            this.onSeatClicked(obj.userData.seatIndex);
          }
          return;
        }
        obj = obj.parent;
      }
    }
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public render(delta: number): void {
    // 1. Kinetic Orrery planetary orbits & ring spin
    if (this.gimbalRings.length >= 3) {
      this.gimbalRings[0].rotation.x += delta * 0.45;
      this.gimbalRings[0].rotation.y += delta * 0.25;
      this.gimbalRings[1].rotation.y += delta * 0.55;
      this.gimbalRings[1].rotation.z += delta * 0.35;
      this.gimbalRings[2].rotation.z += delta * 0.65;
      this.gimbalRings[2].rotation.x += delta * 0.3;
    }
    if (this.orreryCore) {
      this.orreryCore.rotation.y += delta * 0.9;
    }

    for (const p of this.planets) {
      p.userData.angle += delta * p.userData.speed;
      const d = p.userData.distance;
      p.position.set(
        Math.cos(p.userData.angle) * d,
        Math.sin(p.userData.angle * 2) * 0.12,
        Math.sin(p.userData.angle) * d
      );
    }

    // 2. Studio Lighting Transitions
    this.keySpotLight.color.lerp(this.lightColorTarget, delta * 3.5);
    if (this.flickerTimer > 0) {
      this.flickerTimer -= delta;
      if (this.flickerTimer <= 0) {
        this.keySpotLight.intensity = this.lightIntensityTarget;
        this.pedestalUnderLight.intensity = 1.5;
      }
    } else {
      this.keySpotLight.intensity = THREE.MathUtils.lerp(
        this.keySpotLight.intensity,
        this.lightIntensityTarget,
        delta * 3.5
      );
    }

    // 3. Countdown Ring Scaling & Anti-Snipe Burst
    let targetRadius = 1.35 + this.countdownProgress * 1.25;
    if (this.extensionFlashProgress > 0) {
      this.extensionFlashProgress -= delta * 1.6;
      if (this.extensionFlashProgress < 0) this.extensionFlashProgress = 0;
      targetRadius += Math.sin(this.extensionFlashProgress * Math.PI) * 0.95;
    }
    this.countdownRingMesh.scale.set(targetRadius, targetRadius, targetRadius);

    // 4. Update Numerals Odometer & Orient toward camera
    this.odometer.update(delta);
    this.tempVec.set(this.camera.position.x, 4.8, this.camera.position.z);
    this.odometer.group.lookAt(this.tempVec);

    // 5. Active Bid Shockwave Pulses
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

      const t = pulse.progress;
      this.tempVec.lerpVectors(pulse.startPos, pulse.targetPos, t * 0.6);
      pulse.mesh.position.set(this.tempVec.x, 0.05, this.tempVec.z);

      const r = 0.5 + t * pulse.maxRadius;
      pulse.mesh.scale.set(r, r, 1);
      (pulse.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t * t);
    }

    // 6. Camera OrbitControls & Cinematic Close-Up
    if (this.isCloseUpActive && !this.reducedMotion) {
      this.closeUpTimer -= delta;
      this.camera.position.lerp(this.closeUpTargetPos, delta * 2.5);
      this.controls.target.lerp(this.tempVec.set(0, 2.8, 0), delta * 2.5);
      if (this.closeUpTimer <= 0) {
        this.isCloseUpActive = false;
      }
    }

    this.controls.update();

    // 7. Render
    this.renderer.render(this.scene, this.camera);
  }
}
