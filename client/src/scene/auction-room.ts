import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OdometerDisplay } from './numerals.js';

export interface BidderSeatConfig {
  id: string;
  name: string;
  color: string;
  seatIndex: number;
  paddleNumber: string;
  clothingColor: number;
  hairColor: number;
  skinTone: number;
}

export const BIDDER_SEATS: BidderSeatConfig[] = [
  {
    id: 'bidder-1',
    name: 'Alice (Seat 1)',
    color: '#f59e0b',
    seatIndex: 0,
    paddleNumber: '01',
    clothingColor: 0x1f2937, // Midnight Charcoal Suit
    hairColor: 0x8b5a2b,    // Chestnut
    skinTone: 0xf5cfb3,
  },
  {
    id: 'bidder-2',
    name: 'Bob (Seat 2)',
    color: '#10b981',
    seatIndex: 1,
    paddleNumber: '02',
    clothingColor: 0x1e3a5f, // Navy Blazer
    hairColor: 0x3d2817,    // Dark Espresso
    skinTone: 0xdeb896,
  },
  {
    id: 'bidder-3',
    name: 'Claire (Seat 3)',
    color: '#ef4444',
    seatIndex: 2,
    paddleNumber: '03',
    clothingColor: 0x6b2135, // Bordeaux Velvet Jacket
    hairColor: 0xcca062,    // Warm Blonde
    skinTone: 0xfde2cf,
  },
  {
    id: 'bidder-4',
    name: 'David (Seat 4)',
    color: '#06b6d4',
    seatIndex: 3,
    paddleNumber: '04',
    clothingColor: 0x2d3748, // Oxford Slate Suit
    hairColor: 0x4a4a4a,    // Steel Slate
    skinTone: 0xb58058,
  },
  {
    id: 'bidder-5',
    name: 'Elena (Seat 5)',
    color: '#8b5cf6',
    seatIndex: 4,
    paddleNumber: '05',
    clothingColor: 0x3e2723, // Espresso Tweed
    hairColor: 0x1a1a1a,    // Jet Black
    skinTone: 0xdfad8b,
  },
  {
    id: 'bidder-6',
    name: 'Felix (Seat 6)',
    color: '#ec4899',
    seatIndex: 5,
    paddleNumber: '06',
    clothingColor: 0x1a2e26, // British Racing Green Suit
    hairColor: 0x5c4033,    // Walnut Brown
    skinTone: 0xdcb191,
  },
];

interface ActivePulse {
  mesh: THREE.Mesh;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  progress: number;
  duration: number;
  maxRadius: number;
}

interface HumanBidder {
  stationGroup: THREE.Group;
  shoulderPivot: THREE.Group; // raises paddle
  paddleGroup: THREE.Group;
  headGroup: THREE.Group;
  deskLampLight: THREE.PointLight;
  deskLampShade: THREE.Mesh;
  nameSprite: THREE.Sprite;
  spotFloorLight: THREE.SpotLight;
  seatIndex: number;
  paddleRaiseTimer: number;
  idlePhase: number;
}

interface AuctioneerFigure {
  group: THREE.Group;
  gavelArm: THREE.Group; // raises and strikes gavel
  headGroup: THREE.Group;
  gavelTimer: number;
}

// Procedural Canvas Texture: Authentic Sohum Auction Paddle
function createPaddleTexture(paddleNum: string, colorHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Smooth circular ivory card face
  ctx.fillStyle = '#faf7f2';
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0, Math.PI * 2);
  ctx.fill();

  // Signature color outer ring
  ctx.lineWidth = 12;
  ctx.strokeStyle = colorHex;
  ctx.stroke();

  // Fine inner gold border
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#d4af37';
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.stroke();

  // Header: SOHUM'S
  ctx.fillStyle = '#5c4a3b';
  ctx.font = 'bold 15px "Cinzel", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("SOHUM'S", 128, 52);

  // Bold Paddle Number
  ctx.fillStyle = '#141210';
  ctx.font = 'bold 94px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(paddleNum, 128, 130);

  // Subtitle
  ctx.fillStyle = '#8a7664';
  ctx.font = '600 12px "JetBrains Mono", monospace';
  ctx.fillText('LONDON • NY • HK', 128, 196);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// Procedural Canvas Texture: 3D Floating Nameplate Badge
function createNameplateSprite(name: string, color: string, paddleNum: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 76;
  const ctx = canvas.getContext('2d')!;

  // Translucent dark lacquered plaque
  ctx.fillStyle = 'rgba(18, 14, 10, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(6, 6, 288, 64, 18);
  ctx.fill();
  ctx.stroke();

  // Signature color indicator dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(36, 38, 12, 0, Math.PI * 2);
  ctx.fill();

  // Paddle number inside dot
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(paddleNum, 36, 38);

  // Name text
  ctx.fillStyle = '#f8f4ed';
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(name, 58, 38);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.5, 0.42, 1);
  return sprite;
}

// Procedural Canvas Texture: Engraved Brass Desk Plaque
function createDeskPlaqueTexture(name: string, paddleNum: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;

  // Polished brushed brass plaque
  ctx.fillStyle = '#1c1712';
  ctx.fillRect(0, 0, 320, 80);
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 4;
  ctx.strokeRect(5, 5, 310, 70);

  // Engraved gold lettering
  ctx.fillStyle = '#f0d07a';
  ctx.font = 'bold 22px "Cinzel", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`PADDLE #${paddleNum}`, 160, 28);

  ctx.fillStyle = '#e8dcc8';
  ctx.font = 'bold 17px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(name.toUpperCase(), 160, 56);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// Procedural Canvas Texture: Classical Gallery Oil Painting
function createPaintingTexture(theme: 'portrait' | 'sunset' | 'landscape' | 'canal'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  if (theme === 'portrait') {
    // Rembrandt Chiaroscuro Portrait
    const grad = ctx.createRadialGradient(256, 230, 40, 256, 256, 320);
    grad.addColorStop(0, '#f2d3a7');
    grad.addColorStop(0.3, '#a56b3e');
    grad.addColorStop(0.7, '#382012');
    grad.addColorStop(1, '#110a06');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Dark collar silhouette
    ctx.fillStyle = '#22140c';
    ctx.beginPath();
    ctx.ellipse(256, 380, 160, 100, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eeddc6';
    ctx.beginPath();
    ctx.ellipse(256, 290, 60, 25, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (theme === 'sunset') {
    // J.M.W. Turner Golden Sunset Seascape
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#2e4359');
    grad.addColorStop(0.35, '#c86f34');
    grad.addColorStop(0.65, '#f7c358');
    grad.addColorStop(0.8, '#d48839');
    grad.addColorStop(1, '#3a4b52');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Glowing sun orb
    ctx.fillStyle = '#fffce0';
    ctx.beginPath();
    ctx.arc(256, 300, 42, 0, Math.PI * 2);
    ctx.fill();
  } else if (theme === 'landscape') {
    // Constable English Romantic Landscape
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#7594ab');
    grad.addColorStop(0.5, '#cad8df');
    grad.addColorStop(0.55, '#3a4b27');
    grad.addColorStop(0.85, '#223315');
    grad.addColorStop(1, '#15200c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Pastoral trees
    ctx.fillStyle = '#283818';
    ctx.beginPath();
    ctx.arc(140, 260, 90, 0, Math.PI * 2);
    ctx.arc(380, 280, 110, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Venetian Grand Canal at Dusk
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#363d59');
    grad.addColorStop(0.4, '#c98a72');
    grad.addColorStop(0.6, '#4f7282');
    grad.addColorStop(1, '#1a3340');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
  }

  // Museum canvas linen texture overlay
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  for (let i = 0; i < 512; i += 4) {
    ctx.fillRect(i, 0, 1, 512);
    ctx.fillRect(0, i, 512, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// Procedural Canvas Texture: Stage Lot Tote Board Header
function createToteBoardHeaderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 140;
  const ctx = canvas.getContext('2d')!;

  // Deep matte black ebony plate
  ctx.fillStyle = '#100d0a';
  ctx.fillRect(0, 0, 640, 140);

  // Gold classical ornamental border
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, 624, 124);

  // Sohum's Saleroom logo
  ctx.fillStyle = '#f0d38d';
  ctx.font = 'bold 24px "Cinzel", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("SOHUM'S SALEROOM • LONDON", 320, 52);

  // Subheader
  ctx.fillStyle = '#d4af37';
  ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText("LOT #101 : 18TH-CENTURY CELESTIAL ORRERY", 320, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class AuctionRoomScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  public odometer: OdometerDisplay;

  // Authentic Saleroom Lighting (Bright, Luminous, Regal)
  private ambientLight: THREE.AmbientLight;
  private skylightSun: THREE.DirectionalLight;
  private warmFillLight: THREE.DirectionalLight;
  private lotSpotLight: THREE.SpotLight;
  private auctioneerSpotLight: THREE.SpotLight;
  private chandelierLights: THREE.PointLight[] = [];
  private lightIntensityTarget = 3.6;
  private lightColorTarget = new THREE.Color(0xfffaee);

  // Procedural Lot (The Celestial Orrery)
  private orreryGroup!: THREE.Group;
  private gimbalRings: THREE.Mesh[] = [];
  private orreryCore!: THREE.Mesh;
  private planets: THREE.Mesh[] = [];

  // Countdown Ring around Lot Pedestal
  private countdownRingMesh: THREE.Mesh;
  private countdownRingMaterial: THREE.MeshBasicMaterial;
  private countdownProgress = 1.0;
  private extensionFlashProgress = 0;

  // The Human Cast: Auctioneer, 6 Seated Human Bidders, Telephone Clerks, Audience
  public seatMarkers: THREE.Group[] = [];
  private humanBidders: HumanBidder[] = [];
  private auctioneer!: AuctioneerFigure;
  private activePulses: ActivePulse[] = [];
  public activeSeatIndex = 0;

  // Camera Management
  private isCinematicPanning = false;
  private panTimer = 0;
  private panTargetPos = new THREE.Vector3();
  private panTargetLookAt = new THREE.Vector3();
  private reducedMotion = false;
  public onSeatClicked?: (seatIndex: number) => void;

  // Raycasting for interactive clicks
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private tempVec = new THREE.Vector3();

  // Rejection feedback
  private flickerTimer = 0;

  constructor(container: HTMLElement) {
    // 1. Scene setup: Luminous, warm gallery tone (NOT dark void!)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xebe2d5); // Warm cream gallery plaster
    this.scene.fog = new THREE.FogExp2(0xebe2d5, 0.007); // Very subtle atmospheric depth

    // 2. Camera setup: Classic high-tier saleroom viewpoint
    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      160
    );
    // Positioned at a 3/4 gallery angle looking down aisle toward stage
    this.camera.position.set(5.2, 5.0, 12.0);

    // 3. Renderer with ACES Filmic tone mapping for rich, warm luxury colors
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45; // Bright, luminous daylight exposure
    container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 4.0;
    this.controls.maxDistance = 28.0;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going beneath floor
    this.controls.target.set(-0.4, 2.2, -4.5); // Center view on stage and bidders
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.25;

    // 5. Bright Architectural Saleroom Lighting
    // Warm gallery ambient fill
    this.ambientLight = new THREE.AmbientLight(0xfff6ec, 2.9);
    this.scene.add(this.ambientLight);

    // High natural gallery skylight
    this.skylightSun = new THREE.DirectionalLight(0xfffaed, 2.4);
    this.skylightSun.position.set(6, 18, 8);
    this.skylightSun.castShadow = true;
    this.skylightSun.shadow.mapSize.width = 2048;
    this.skylightSun.shadow.mapSize.height = 2048;
    this.skylightSun.shadow.bias = -0.0001;
    this.skylightSun.shadow.camera.near = 2;
    this.skylightSun.shadow.camera.far = 40;
    this.skylightSun.shadow.camera.left = -16;
    this.skylightSun.shadow.camera.right = 16;
    this.skylightSun.shadow.camera.top = 16;
    this.skylightSun.shadow.camera.bottom = -16;
    this.scene.add(this.skylightSun);

    // Soft warm secondary fill light from opposite corner
    this.warmFillLight = new THREE.DirectionalLight(0xe8d6c1, 1.3);
    this.warmFillLight.position.set(-8, 14, -8);
    this.scene.add(this.warmFillLight);

    // Focused gallery spotlight on the Lot Pedestal
    this.lotSpotLight = new THREE.SpotLight(0xfff8e8, 3.8, 30, Math.PI / 4.8, 0.35, 1.0);
    this.lotSpotLight.position.set(2.4, 15, -4.0);
    this.lotSpotLight.castShadow = true;
    this.lotSpotLight.shadow.bias = -0.0001;
    const lotTarget = new THREE.Object3D();
    lotTarget.position.set(2.4, 2.6, -7.5);
    this.scene.add(lotTarget);
    this.lotSpotLight.target = lotTarget;
    this.scene.add(this.lotSpotLight);

    // Focused spotlight on the Auctioneer's Rostrum
    this.auctioneerSpotLight = new THREE.SpotLight(0xfff4df, 2.8, 26, Math.PI / 5, 0.4, 1.0);
    this.auctioneerSpotLight.position.set(-3.2, 14, -4.5);
    const auctioneerTarget = new THREE.Object3D();
    auctioneerTarget.position.set(-3.2, 2.2, -7.8);
    this.scene.add(auctioneerTarget);
    this.auctioneerSpotLight.target = auctioneerTarget;
    this.scene.add(this.auctioneerSpotLight);

    // 6. Build the Architecture of the Classical Auction House
    this.buildSaleroomArchitecture();

    // 7. Build the Stage, Rostrum, and Lot Pedestal
    this.buildStageAndLot();

    // 8. 3D Odometer Numerals mounted in the Stage Tote Board
    this.odometer = new OdometerDisplay();
    // Mount the price board on the stage back wall above lot & auctioneer
    this.odometer.group.position.set(0, 5.0, -11.0);
    this.scene.add(this.odometer.group);

    // 9. Build Human Figures: The Auctioneer & 6 VIP Bidders with Paddles
    this.buildAuctioneer();
    this.buildHumanBidders();

    // 10. Build Phone Bidding Bank Clerks & Audience Gallery
    this.buildPhoneBank();
    this.buildAudienceGallery();

    // 11. Countdown Ring around Lot Pedestal on Stage
    const ringGeom = new THREE.RingGeometry(2.1, 2.3, 64);
    this.countdownRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.countdownRingMesh = new THREE.Mesh(ringGeom, this.countdownRingMaterial);
    this.countdownRingMesh.rotation.x = -Math.PI / 2;
    this.countdownRingMesh.position.set(2.4, 0.47, -7.5);
    this.scene.add(this.countdownRingMesh);

    // Reduced motion preference
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) {
      this.controls.autoRotate = false;
    }

    // Event listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
  }

  // --- SALEROOM ARCHITECTURE & FINE ART ---
  private buildSaleroomArchitecture(): void {
    const roomW = 28;
    const roomL = 34;
    const roomH = 12;

    // 1. Polished French Oak Parquet Flooring
    const floorGeom = new THREE.PlaneGeometry(roomW, roomL);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x5e4531, // Golden French Oak
      roughness: 0.35,
      metalness: 0.18,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 2. Center Aisle Royal Crimson Velvet Runner Carpet
    const carpetGeom = new THREE.PlaneGeometry(4.2, 24);
    const carpetMat = new THREE.MeshStandardMaterial({
      color: 0x7c151c, // Sohum Royal Crimson
      roughness: 0.88,
      metalness: 0.05,
    });
    const carpet = new THREE.Mesh(carpetGeom, carpetMat);
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.015, 3.5);
    carpet.receiveShadow = true;
    this.scene.add(carpet);

    // Gold braided fringe border along carpet
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.3 });
    const bLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 24), borderMat);
    bLeft.position.set(-2.1, 0.02, 3.5);
    this.scene.add(bLeft);
    const bRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 24), borderMat);
    bRight.position.set(2.1, 0.02, 3.5);
    this.scene.add(bRight);

    // 3. Classical Gallery Walls (Upper Cream Plaster, Lower Walnut Wainscoting)
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xf5eee4, roughness: 0.85 });
    const wainscotMat = new THREE.MeshStandardMaterial({ color: 0x3d291b, roughness: 0.52, metalness: 0.12 });
    const mouldingMat = new THREE.MeshStandardMaterial({ color: 0xdfcfb0, roughness: 0.55 });
    const goldTrimMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 });

    // Back Stage Wall (z = -12)
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomH), plasterMat);
    backWall.position.set(0, roomH / 2, -12);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const backWainscot = new THREE.Mesh(new THREE.PlaneGeometry(roomW, 3.2), wainscotMat);
    backWainscot.position.set(0, 1.6, -11.97);
    this.scene.add(backWainscot);

    const backDado = new THREE.Mesh(new THREE.BoxGeometry(roomW, 0.14, 0.08), mouldingMat);
    backDado.position.set(0, 3.2, -11.95);
    this.scene.add(backDado);

    // Side Walls (Left x = -roomW/2, Right x = roomW/2)
    const sideWallGeom = new THREE.PlaneGeometry(roomL, roomH);

    const leftWall = new THREE.Mesh(sideWallGeom, plasterMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-roomW / 2, roomH / 2, 2);
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    const leftWainscot = new THREE.Mesh(new THREE.PlaneGeometry(roomL, 3.2), wainscotMat);
    leftWainscot.rotation.y = Math.PI / 2;
    leftWainscot.position.set(-roomW / 2 + 0.03, 1.6, 2);
    this.scene.add(leftWainscot);

    const leftDado = new THREE.Mesh(new THREE.BoxGeometry(roomL, 0.14, 0.08), mouldingMat);
    leftDado.rotation.y = Math.PI / 2;
    leftDado.position.set(-roomW / 2 + 0.05, 3.2, 2);
    this.scene.add(leftDado);

    const rightWall = new THREE.Mesh(sideWallGeom, plasterMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(roomW / 2, roomH / 2, 2);
    rightWall.receiveShadow = true;
    this.scene.add(rightWall);

    const rightWainscot = new THREE.Mesh(new THREE.PlaneGeometry(roomL, 3.2), wainscotMat);
    rightWainscot.rotation.y = -Math.PI / 2;
    rightWainscot.position.set(roomW / 2 - 0.03, 1.6, 2);
    this.scene.add(rightWainscot);

    const rightDado = new THREE.Mesh(new THREE.BoxGeometry(roomL, 0.14, 0.08), mouldingMat);
    rightDado.rotation.y = -Math.PI / 2;
    rightDado.position.set(roomW / 2 - 0.05, 3.2, 2);
    this.scene.add(rightDado);

    // Classical Pilasters (Columns) along side walls
    for (const z of [-8, -2, 4, 10, 16]) {
      this.buildPilaster(new THREE.Vector3(-roomW / 2 + 0.15, 6, z), mouldingMat, goldTrimMat);
      this.buildPilaster(new THREE.Vector3(roomW / 2 - 0.15, 6, z), mouldingMat, goldTrimMat);
    }

    // 4. Coffered Ceiling
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomL), plasterMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, roomH, 2);
    this.scene.add(ceiling);

    // Ceiling beams / coffers
    for (let x = -10; x <= 10; x += 5) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, roomL), mouldingMat);
      beam.position.set(x, roomH - 0.22, 2);
      this.scene.add(beam);
    }

    // 5. Grand Crystal & Brass Chandeliers (4 hanging across saleroom)
    this.buildChandelier(new THREE.Vector3(-4.5, 8.8, -5.5));
    this.buildChandelier(new THREE.Vector3(4.5, 8.8, -5.5));
    this.buildChandelier(new THREE.Vector3(-4.5, 8.8, 4.5));
    this.buildChandelier(new THREE.Vector3(4.5, 8.8, 4.5));

    // 6. Framed Fine Art Masterpieces on Side Walls
    this.buildFramedPainting(new THREE.Vector3(-roomW / 2 + 0.1, 6.2, -5), 3.2, 4.0, 'portrait', Math.PI / 2);
    this.buildFramedPainting(new THREE.Vector3(-roomW / 2 + 0.1, 6.2, 1), 3.8, 2.8, 'sunset', Math.PI / 2);
    this.buildFramedPainting(new THREE.Vector3(-roomW / 2 + 0.1, 6.2, 7), 3.5, 3.8, 'landscape', Math.PI / 2);

    this.buildFramedPainting(new THREE.Vector3(roomW / 2 - 0.1, 6.2, -5), 3.2, 4.0, 'canal', -Math.PI / 2);
    this.buildFramedPainting(new THREE.Vector3(roomW / 2 - 0.1, 6.2, 1), 3.8, 2.8, 'landscape', -Math.PI / 2);
    this.buildFramedPainting(new THREE.Vector3(roomW / 2 - 0.1, 6.2, 7), 3.5, 3.8, 'portrait', -Math.PI / 2);

    // 7. Brass VIP Stanchions with Twisted Velvet Ropes along central aisle
    for (const z of [-3, 0, 3, 6, 9]) {
      this.buildStanchion(new THREE.Vector3(-2.3, 0, z));
      this.buildStanchion(new THREE.Vector3(2.3, 0, z));
    }
  }

  private buildPilaster(pos: THREE.Vector3, mat: THREE.Material, goldMat: THREE.Material): void {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 11.5, 0.6), mat);
    col.position.copy(pos);
    this.scene.add(col);

    // Capital & base in gold
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.75), goldMat);
    cap.position.set(pos.x, 11.4, pos.z);
    this.scene.add(cap);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.75), mat);
    base.position.set(pos.x, 0.25, pos.z);
    this.scene.add(base);
  }

  private buildChandelier(pos: THREE.Vector3): void {
    const chandelier = new THREE.Group();
    chandelier.position.copy(pos);

    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.92, roughness: 0.2 });

    // Hanging brass chain
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), brassMat);
    chain.position.y = 1.3;
    chandelier.add(chain);

    // Ornate brass hub & double rings
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.09, 12, 36), brassMat);
    ring1.rotation.x = Math.PI / 2;
    chandelier.add(ring1);

    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 10, 32), brassMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = -0.35;
    chandelier.add(ring2);

    // 8 Candles with flame glow
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * 1.8;
      const z = Math.sin(a) * 1.8;

      const candle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.38, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff6dd })
      );
      candle.position.set(x, 0.2, z);
      chandelier.add(candle);

      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd27d })
      );
      flame.position.set(x, 0.44, z);
      flame.scale.set(0.7, 1.4, 0.7);
      chandelier.add(flame);
    }

    // Warm chandelier light source
    const light = new THREE.PointLight(0xfff0d0, 2.2, 16, 1.1);
    light.position.set(0, -0.2, 0);
    chandelier.add(light);
    this.chandelierLights.push(light);

    this.scene.add(chandelier);
  }

  private buildFramedPainting(
    pos: THREE.Vector3,
    w: number,
    h: number,
    theme: 'portrait' | 'sunset' | 'landscape' | 'canal',
    rotY: number
  ): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    group.rotation.y = rotY;

    // Gilded Rococo Picture Frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xbfa046, metalness: 0.88, roughness: 0.28 })
    );
    group.add(frame);

    // Artwork Canvas with Procedural Painting Texture
    const canvasTex = createPaintingTexture(theme);
    const canvas = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.65 })
    );
    canvas.position.z = 0.07;
    group.add(canvas);

    // Dedicated Brass Picture Light above the painting
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 });
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), brassMat);
    lampStem.position.set(0, h / 2 + 0.2, 0.25);
    lampStem.rotation.x = -Math.PI / 4;
    group.add(lampStem);

    const lampShade = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.08, 0.1), brassMat);
    lampShade.position.set(0, h / 2 + 0.32, 0.35);
    group.add(lampShade);

    const picLight = new THREE.SpotLight(0xffecd2, 1.4, 6, Math.PI / 3);
    picLight.position.set(0, h / 2 + 0.3, 0.35);
    picLight.target.position.set(0, 0, 0);
    group.add(picLight);
    group.add(picLight.target);

    this.scene.add(group);
  }

  private buildStanchion(pos: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(pos);

    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.18 });

    // Base plinth
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.06, 16), brassMat);
    base.position.y = 0.03;
    group.add(base);

    // Polished brass post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 12), brassMat);
    post.position.y = 0.5;
    group.add(post);

    // Spherical finial on top
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), brassMat);
    finial.position.y = 1.0;
    group.add(finial);

    this.scene.add(group);
  }

  // --- STAGE, AUCTIONEER ROSTRUM, AND LOT PEDESTAL ---
  private buildStageAndLot(): void {
    // 1. Elevated Stage Dais
    const stageW = 20;
    const stageD = 5.2;
    const stageH = 0.45;
    const stagePos = new THREE.Vector3(0, stageH / 2, -9.0);

    const stageMat = new THREE.MeshStandardMaterial({
      color: 0x2e1e14, // Dark polished walnut stage
      roughness: 0.35,
      metalness: 0.18,
    });
    const stage = new THREE.Mesh(new THREE.BoxGeometry(stageW, stageH, stageD), stageMat);
    stage.position.copy(stagePos);
    stage.receiveShadow = true;
    this.scene.add(stage);

    // Polished brass bullnose edge trim along stage front
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.92, roughness: 0.2 });
    const edgeTrim = new THREE.Mesh(new THREE.BoxGeometry(stageW, 0.06, 0.08), brassMat);
    edgeTrim.position.set(0, stageH, -9.0 + stageD / 2);
    this.scene.add(edgeTrim);

    // 2. Royal Velvet Backdrop Curtains
    const curtainMat = new THREE.MeshStandardMaterial({
      color: 0x6e1018, // Deep theatrical burgundy
      roughness: 0.92,
      metalness: 0.04,
    });

    // Fluted curtain folds across back stage wall
    for (let x = -8.5; x <= 8.5; x += 0.8) {
      const fold = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8.5, 12), curtainMat);
      fold.position.set(x, 4.7, -11.6);
      fold.scale.set(1.0, 1.0, 0.35);
      this.scene.add(fold);
    }

    // Gold valance across the top of the curtains
    const valance = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 0.35), brassMat);
    valance.position.set(0, 8.8, -11.5);
    this.scene.add(valance);

    // 3. Stage Tote Board Header (Sohum Saleroom)
    const headerTex = createToteBoardHeaderTexture();
    const headerMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.4),
      new THREE.MeshStandardMaterial({ map: headerTex, roughness: 0.35 })
    );
    headerMesh.position.set(0, 6.8, -11.2);
    this.scene.add(headerMesh);

    // Gilded frame around tote board
    const toteFrame = new THREE.Mesh(
      new THREE.BoxGeometry(6.65, 4.2, 0.12),
      brassMat
    );
    toteFrame.position.set(0, 5.2, -11.3);
    this.scene.add(toteFrame);

    // 4. Central Lot Pedestal (White Carrara Marble & Gold Fluting)
    this.buildLotPedestal(new THREE.Vector3(2.4, 0.45, -7.5));

    // 5. Procedural Lot (The 18th-Century Celestial Orrery)
    this.orreryGroup = this.buildOrrery();
    this.orreryGroup.position.set(2.4, 3.2, -7.5);
    this.scene.add(this.orreryGroup);
  }

  private buildLotPedestal(pos: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(pos);

    const marbleMat = new THREE.MeshStandardMaterial({
      color: 0xeee7dc, // Carrara marble
      roughness: 0.22,
      metalness: 0.15,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.92,
      roughness: 0.22,
    });

    // Plinth base
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.25, 36), marbleMat);
    b1.position.y = 0.125;
    b1.castShadow = true;
    b1.receiveShadow = true;
    group.add(b1);

    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.25, 36), marbleMat);
    b2.position.y = 0.375;
    group.add(b2);

    // Fluted Column body
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.55, 1.6, 36), marbleMat);
    col.position.y = 1.3;
    col.castShadow = true;
    group.add(col);

    // 16 Gilded fluting ribs
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), brassMat);
      rib.position.set(Math.cos(a) * 1.48, 1.3, Math.sin(a) * 1.48);
      group.add(rib);
    }

    // Capital
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.5, 0.35, 36), marbleMat);
    cap.position.y = 2.25;
    cap.castShadow = true;
    group.add(cap);

    // Gold rim top
    const topRim = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.06, 16, 48), brassMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = 2.42;
    group.add(topRim);

    this.scene.add(group);
  }

  private buildOrrery(): THREE.Group {
    const group = new THREE.Group();

    const polishedGold = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.96,
      roughness: 0.1,
    });

    const radii = [0.92, 0.70, 0.50];
    for (let i = 0; i < radii.length; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radii[i], 0.035, 16, 54), polishedGold);
      ring.castShadow = true;
      group.add(ring);
      this.gimbalRings.push(ring);
    }

    // Glowing sun core
    const coreGeom = new THREE.OctahedronGeometry(0.28, 2);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xfffae0,
      metalness: 0.8,
      roughness: 0.15,
      emissive: 0xffb700,
      emissiveIntensity: 1.1,
    });
    this.orreryCore = new THREE.Mesh(coreGeom, coreMat);
    this.orreryCore.castShadow = true;
    group.add(this.orreryCore);

    // 3 Orbiting jewel planets
    const planetColors = [0xef4444, 0x10b981, 0x3b82f6];
    const planetDistances = [0.42, 0.64, 0.86];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 16),
        new THREE.MeshStandardMaterial({ color: planetColors[i], metalness: 0.8, roughness: 0.2 })
      );
      p.castShadow = true;
      p.userData = { distance: planetDistances[i], speed: 1.4 - i * 0.4, angle: (i * Math.PI) / 1.5 };
      group.add(p);
      this.planets.push(p);
    }

    return group;
  }

  // --- AUCTIONEER (HUMAN FIGURE WITH GAVEL & ROSTRUM) ---
  private buildAuctioneer(): void {
    const group = new THREE.Group();
    // Positioned on the left side of the stage facing the saleroom
    group.position.set(-3.2, 0.45, -7.5);
    group.rotation.y = 0.35; // Angled toward audience and lot

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x332216, roughness: 0.42, metalness: 0.1 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.92, roughness: 0.2 });

    // 1. Classical Carved Mahogany Rostrum
    const rostrum = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.28, 1.1), woodMat);
    rostrum.position.y = 0.64;
    rostrum.castShadow = true;
    rostrum.receiveShadow = true;
    group.add(rostrum);

    // Slanted top reading desk
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.2), woodMat);
    deskTop.position.y = 1.32;
    deskTop.rotation.x = 0.15;
    group.add(deskTop);

    // Brass trim on rostrum
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.05, 1.14), brassMat);
    trim.position.y = 1.26;
    group.add(trim);

    // Gavel sound block
    const gavelBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 16), woodMat);
    gavelBlock.position.set(0.32, 1.36, 0.12);
    group.add(gavelBlock);

    // Gooseneck microphone
    const micStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.32, 8), brassMat);
    micStem.position.set(-0.4, 1.45, 0.2);
    micStem.rotation.x = -0.3;
    group.add(micStem);

    const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    micHead.position.set(-0.4, 1.6, 0.28);
    group.add(micHead);

    // 2. The Human Auctioneer Figure
    const figureGroup = new THREE.Group();
    figureGroup.position.set(0, 0, -0.45);

    // Legs / Formal Trousers
    const trousers = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 1.0, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 })
    );
    trousers.position.y = 0.5;
    figureGroup.add(trousers);

    // Torso in tailored black tuxedo jacket
    const tuxedoTorso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.26, 0.88, 16),
      new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.55 })
    );
    tuxedoTorso.position.y = 1.44;
    tuxedoTorso.castShadow = true;
    figureGroup.add(tuxedoTorso);

    // Pleated white wing-collar shirt bib
    const shirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.32, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    shirt.position.set(0, 1.6, 0.22);
    figureGroup.add(shirt);

    // Black satin bowtie
    const bowtie = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.06, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
    );
    bowtie.position.set(0, 1.72, 0.26);
    figureGroup.add(bowtie);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.14, 12),
      new THREE.MeshStandardMaterial({ color: 0xe2b492, roughness: 0.6 })
    );
    neck.position.y = 1.94;
    figureGroup.add(neck);

    // Head Group
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 2.08, 0);

    const cranium = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2b492, roughness: 0.6 })
    );
    cranium.scale.set(1.0, 1.15, 1.05);
    headGroup.add(cranium);

    // Sculpted nose profile
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.08, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xdcb08c, roughness: 0.6 })
    );
    nose.position.set(0, 0, 0.2);
    headGroup.add(nose);

    // Styled slicked-back formal hair
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.7 })
    );
    hair.position.set(0, 0.04, -0.04);
    headGroup.add(hair);

    figureGroup.add(headGroup);

    // Left arm resting comfortably on rostrum desk
    const leftArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.055, 0.68, 8),
      new THREE.MeshStandardMaterial({ color: 0x161618 })
    );
    leftArm.position.set(-0.36, 1.34, 0.22);
    leftArm.rotation.x = -0.55;
    leftArm.rotation.z = -0.15;
    figureGroup.add(leftArm);

    // Right arm (Shoulder Pivot) holding the Gavel
    const gavelArmPivot = new THREE.Group();
    gavelArmPivot.position.set(0.38, 1.72, 0.05);

    const rightArmMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.055, 0.62, 8),
      new THREE.MeshStandardMaterial({ color: 0x161618 })
    );
    rightArmMesh.position.set(0, -0.26, 0.16);
    rightArmMesh.rotation.x = -0.4;
    gavelArmPivot.add(rightArmMesh);

    // Rosewood Gavel with brass rings
    const gavelHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8), brassMat);
    gavelHandle.position.set(0, -0.44, 0.25);
    gavelHandle.rotation.x = Math.PI / 2;
    gavelArmPivot.add(gavelHandle);

    const gavelHead = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 16), woodMat);
    gavelHead.position.set(0, -0.44, 0.44);
    gavelHead.rotation.z = Math.PI / 2;
    gavelArmPivot.add(gavelHead);

    figureGroup.add(gavelArmPivot);
    group.add(figureGroup);

    this.scene.add(group);
    this.auctioneer = {
      group,
      gavelArm: gavelArmPivot,
      headGroup,
      gavelTimer: 0,
    };
  }

  // --- SEATED HUMAN BIDDERS WITH ANIMATED PADDLES ---
  public getSeatCoordinate(index: number): { x: number; z: number; rotY: number } {
    const seatCoordinates = [
      { x: -3.4, z: -3.2, rotY: 0.2 },   // Alice (Seat 1)
      { x: 0.0,  z: -3.6, rotY: 0.0 },   // Bob (Seat 2)
      { x: 3.4,  z: -3.2, rotY: -0.2 },  // Claire (Seat 3)
      { x: -4.4, z: 1.4,  rotY: 0.25 },  // David (Seat 4)
      { x: 0.0,  z: 1.0,  rotY: 0.0 },   // Elena (Seat 5)
      { x: 4.4,  z: 1.4,  rotY: -0.25 }, // Felix (Seat 6)
      { x: -5.4, z: 5.6,  rotY: 0.3 },   // VIP Table 7
      { x: -1.8, z: 5.2,  rotY: 0.1 },   // VIP Table 8
      { x: 1.8,  z: 5.2,  rotY: -0.1 },  // VIP Table 9
      { x: 5.4,  z: 5.6,  rotY: -0.3 },  // VIP Table 10
      { x: -6.0, z: 9.6,  rotY: 0.35 },  // VIP Table 11
      { x: -2.0, z: 9.2,  rotY: 0.12 },  // VIP Table 12
      { x: 2.0,  z: 9.2,  rotY: -0.12 }, // VIP Table 13
      { x: 6.0,  z: 9.6,  rotY: -0.35 }, // VIP Table 14
    ];

    if (index < seatCoordinates.length) {
      return seatCoordinates[index];
    }
    const row = Math.floor(index / 4);
    const col = index % 4;
    const x = (col - 1.5) * 3.8;
    const z = 4.0 + row * 4.0;
    const rotY = -(x / 20);
    return { x, z, rotY };
  }

  public addBidderStation(cfg: BidderSeatConfig): void {
    const i = cfg.seatIndex;
    const coord = this.getSeatCoordinate(i);

      const stationGroup = new THREE.Group();
      stationGroup.position.set(coord.x, 0, coord.z);
      stationGroup.rotation.y = coord.rotY;
      stationGroup.userData = { seatIndex: i, bidderId: cfg.id };

      const deskWoodMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.44 });
      const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.92, roughness: 0.2 });

      // 1. Classical Mahogany Bidding Desk
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.84, 0.85), deskWoodMat);
      desk.position.y = 0.42;
      desk.castShadow = true;
      desk.receiveShadow = true;
      stationGroup.add(desk);

      // Green leather blotter pad on desk
      const blotter = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.02, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x1f382b, roughness: 0.7 })
      );
      blotter.position.set(0, 0.85, 0.05);
      stationGroup.add(blotter);

      // Open auction catalog booklet on desk
      const catalog = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.02, 0.28),
        new THREE.MeshStandardMaterial({ color: 0xf5f0ea, roughness: 0.8 })
      );
      catalog.position.set(-0.25, 0.86, 0.08);
      catalog.rotation.y = -0.15;
      stationGroup.add(catalog);

      // Engraved brass desk nameplate plaque (front and rear)
      const plaqueTex = createDeskPlaqueTexture(cfg.name, cfg.paddleNumber);
      const deskPlaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.35, metalness: 0.85 });

      const deskPlaqueFront = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.18, 0.02),
        deskPlaqueMat
      );
      deskPlaqueFront.position.set(0, 0.62, -0.43);
      deskPlaqueFront.rotation.y = Math.PI; // Faces toward stage
      stationGroup.add(deskPlaqueFront);

      const deskPlaqueRear = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.18, 0.02),
        deskPlaqueMat
      );
      deskPlaqueRear.position.set(0, 0.62, 0.43);
      stationGroup.add(deskPlaqueRear);

      // Water glass
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.03, 0.1, 12),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, roughness: 0.1 })
      );
      glass.position.set(0.48, 0.89, 0.2);
      stationGroup.add(glass);

      // 2. High-Back Burgundy Leather Executive Chair
      const chairGroup = new THREE.Group();
      chairGroup.position.set(0, 0, 0.65);

      const leatherMat = new THREE.MeshStandardMaterial({ color: 0x421319, roughness: 0.5 });
      const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.65), leatherMat);
      chairSeat.position.y = 0.52;
      chairGroup.add(chairSeat);

      const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.8, 0.12), leatherMat);
      chairBack.position.set(0, 0.95, 0.28);
      chairGroup.add(chairBack);
      stationGroup.add(chairGroup);

      // 3. HUMAN BIDDER FIGURE (Fully Articulated Humanoid Anatomy)
      const human = new THREE.Group();
      human.position.set(0, 0, 0.6);

      // Suit fabric material tailored to bidder
      const suitMat = new THREE.MeshStandardMaterial({ color: cfg.clothingColor, roughness: 0.65 });
      const skinMat = new THREE.MeshStandardMaterial({ color: cfg.skinTone, roughness: 0.6 });
      const hairMat = new THREE.MeshStandardMaterial({ color: cfg.hairColor, roughness: 0.7 });

      // Seated hips & thighs extending forward beneath the desk
      const thighs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.44), suitMat);
      thighs.position.set(0, 0.54, -0.18);
      human.add(thighs);

      // Torso in tailored suit jacket
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.82, 16), suitMat);
      torso.position.y = 1.02;
      torso.castShadow = true;
      human.add(torso);

      // Stiff white collared shirt
      const shirtBib = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.26, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      shirtBib.position.set(0, 1.28, -0.2);
      human.add(shirtBib);

      // Silk necktie in seat's signature color
      const tie = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.36, 0.05),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.color) })
      );
      tie.position.set(0, 1.22, -0.24);
      human.add(tie);

      // Neck
      const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.12, 12), skinMat);
      neckMesh.position.y = 1.48;
      human.add(neckMesh);

      // Head Group
      const headGroup = new THREE.Group();
      headGroup.position.set(0, 1.62, 0);

      const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), skinMat);
      cranium.scale.set(1.0, 1.15, 1.05);
      headGroup.add(cranium);

      // Nose profile
      const noseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.06), skinMat);
      noseMesh.position.set(0, 0, -0.18);
      headGroup.add(noseMesh);

      // Styled hair
      const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), hairMat);
      hairMesh.position.set(0, 0.04, 0.04);
      headGroup.add(hairMesh);

      human.add(headGroup);

      // Left arm resting comfortably on desk blotter
      const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.65, 8), suitMat);
      leftArm.position.set(-0.35, 0.94, -0.28);
      leftArm.rotation.x = 0.7;
      leftArm.rotation.z = 0.2;
      human.add(leftArm);

      // Right arm (Shoulder Pivot) holding the Auction Paddle!
      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(0.36, 1.28, -0.05);

      const rightArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.62, 8), suitMat);
      rightArmMesh.position.set(0, -0.24, -0.16);
      rightArmMesh.rotation.x = 0.55;
      shoulderPivot.add(rightArmMesh);

      // Auction Paddle held in right hand
      const paddleGroup = new THREE.Group();
      paddleGroup.position.set(0, -0.44, -0.38);

      // Rosewood handle
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.75, 8), brassMat);
      handle.position.y = 0.35;
      paddleGroup.add(handle);

      // Dual-sided paddle with crisp printed number on BOTH front and back
      const paddleTex = createPaddleTexture(cfg.paddleNumber, cfg.color);
      const paddleMat = new THREE.MeshStandardMaterial({
        map: paddleTex,
        roughness: 0.28,
        metalness: 0.12,
      });

      // Front disc (faces stage)
      const frontDisc = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), paddleMat);
      frontDisc.position.set(0, 0.76, -0.016);
      frontDisc.rotation.y = Math.PI;
      paddleGroup.add(frontDisc);

      // Back disc (faces audience/camera)
      const backDisc = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), paddleMat);
      backDisc.position.set(0, 0.76, 0.016);
      paddleGroup.add(backDisc);

      // Brass rim and wooden body
      const plaqueRim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 8, 32), brassMat);
      plaqueRim.position.y = 0.76;
      paddleGroup.add(plaqueRim);

      const woodenBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.245, 0.245, 0.03, 32),
        new THREE.MeshStandardMaterial({ color: 0x2e1e12, roughness: 0.5 })
      );
      woodenBody.rotation.x = Math.PI / 2;
      woodenBody.position.y = 0.76;
      paddleGroup.add(woodenBody);

      shoulderPivot.add(paddleGroup);
      human.add(shoulderPivot);
      stationGroup.add(human);

      // 4. Emerald Glass Banker's Desk Lamp
      const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 8), brassMat);
      lampStem.position.set(-0.62, 1.02, -0.15);
      stationGroup.add(lampStem);

      const lampShade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.15, 0.12, 16),
        new THREE.MeshStandardMaterial({
          color: 0x155e3c, // Emerald green
          emissive: new THREE.Color(cfg.color),
          emissiveIntensity: 0.9,
          roughness: 0.2,
        })
      );
      lampShade.position.set(-0.62, 1.2, -0.15);
      stationGroup.add(lampShade);

      const lampLight = new THREE.PointLight(new THREE.Color(cfg.color), 1.4, 4.2);
      lampLight.position.set(-0.62, 1.15, -0.15);
      stationGroup.add(lampLight);

      // 5. Floor Spot Accent Light
      const spotFloorLight = new THREE.SpotLight(new THREE.Color(cfg.color), 0.8, 6.0, Math.PI / 3);
      spotFloorLight.position.set(0, 3.8, 0);
      stationGroup.add(spotFloorLight);

      // 6. Sleek, elevated floating badge above head
      const nameSprite = createNameplateSprite(cfg.name, cfg.color, cfg.paddleNumber);
      nameSprite.position.set(0, 2.65, 0);
      nameSprite.scale.set(1.5, 0.42, 1);
      (nameSprite.material as THREE.SpriteMaterial).opacity = i === 0 ? 0.95 : 0.35;
      stationGroup.add(nameSprite);

      this.scene.add(stationGroup);
      this.seatMarkers.push(stationGroup);

      this.humanBidders.push({
        stationGroup,
        shoulderPivot,
        paddleGroup,
        headGroup,
        deskLampLight: lampLight,
        deskLampShade: lampShade,
        nameSprite,
        spotFloorLight,
        seatIndex: i,
        paddleRaiseTimer: 0,
        idlePhase: i * 1.05,
      });
  }

  private buildHumanBidders(): void {
    for (let i = 0; i < BIDDER_SEATS.length; i++) {
      this.addBidderStation(BIDDER_SEATS[i]);
    }
  }

  public focusOnSeat(seatIndex: number): void {
    const pos = this.getSeatPosition(seatIndex);
    this.controls.target.set(pos.x, 1.6, pos.z);
    this.camera.position.set(pos.x * 0.7, 3.8, pos.z + 4.2);
  }


  // --- STAGE PHONE BIDDING BANK (SOHUM'S PHONE CLERKS) ---
  private buildPhoneBank(): void {
    const group = new THREE.Group();
    group.position.set(-7.5, 0.45, -7.5);

    const deskMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.45 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.84, 0.8), deskMat);
    desk.position.y = 0.42;
    desk.castShadow = true;
    group.add(desk);

    // 2 Telephone clerks in business attire
    for (let c = 0; c < 2; c++) {
      const xOffset = c === 0 ? -0.55 : 0.55;

      const clerk = new THREE.Group();
      clerk.position.set(xOffset, 0, -0.38);

      const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.22, 0.72, 12),
        new THREE.MeshStandardMaterial({ color: c === 0 ? 0x242d3d : 0x3b332b, roughness: 0.6 })
      );
      torso.position.y = 0.95;
      clerk.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xe5ba98, roughness: 0.6 })
      );
      head.position.y = 1.45;
      clerk.add(head);

      // Telephone headset
      const headset = new THREE.Mesh(
        new THREE.TorusGeometry(0.17, 0.02, 8, 16, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      headset.rotation.z = Math.PI;
      headset.position.y = 1.5;
      clerk.add(headset);

      group.add(clerk);
    }

    this.scene.add(group);
  }

  // --- AUDIENCE GALLERY (ROWS OF SEATED PATRONS) ---
  private buildAudienceGallery(): void {
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x4a181e, roughness: 0.55 });
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.7 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xdcb290, roughness: 0.6 });

    // 3 Rows of audience seats in the rear gallery
    const rowZs = [4.5, 7.5, 10.5];
    for (const rz of rowZs) {
      for (let rx = -9; rx <= 9; rx += 1.8) {
        // Leave central aisle open for red carpet
        if (Math.abs(rx) < 2.4) continue;

        const chair = new THREE.Group();
        chair.position.set(rx, 0, rz);

        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.1, 0.55), chairMat);
        seat.position.y = 0.45;
        chair.add(seat);

        const back = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.1), chairMat);
        back.position.set(0, 0.75, 0.25);
        chair.add(back);

        // Seated spectator
        const patron = new THREE.Group();
        const pTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.68, 12), suitMat);
        pTorso.position.y = 0.84;
        patron.add(pTorso);

        const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skinMat);
        pHead.position.y = 1.3;
        patron.add(pHead);
        chair.add(patron);

        this.scene.add(chair);
      }
    }
  }

  // --- INTERACTION & SEAT SWITCHING ---
  public setActiveSeat(seatIndex: number): void {
    this.activeSeatIndex = seatIndex;
    for (let i = 0; i < this.humanBidders.length; i++) {
      const b = this.humanBidders[i];
      if (i === seatIndex) {
        b.deskLampLight.intensity = 2.8;
        (b.deskLampShade.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0;
        b.spotFloorLight.intensity = 1.8;
        (b.nameSprite.material as THREE.SpriteMaterial).opacity = 1.0;
        b.nameSprite.scale.set(1.9, 0.52, 1);
      } else {
        b.deskLampLight.intensity = 1.0;
        (b.deskLampShade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
        b.spotFloorLight.intensity = 0.35;
        (b.nameSprite.material as THREE.SpriteMaterial).opacity = 0.35;
        b.nameSprite.scale.set(1.4, 0.38, 1);
      }
    }
  }

  public getSeatPosition(seatIndex: number): THREE.Vector3 {
    if (this.seatMarkers[seatIndex]) {
      return this.seatMarkers[seatIndex].position.clone();
    }
    return new THREE.Vector3(0, 0, 0);
  }

  // Bid Accepted: Bidder raises paddle high! Auctioneer strikes gavel! Gold shockwave!
  public triggerAcceptedBid(seatIndex: number, bidderColorHex: string): void {
    const seatPos = this.getSeatPosition(seatIndex);

    // 1. BIDDER ANIMATION: Raises paddle high into the air!
    if (this.humanBidders[seatIndex]) {
      this.humanBidders[seatIndex].paddleRaiseTimer = 2.2;
      (this.humanBidders[seatIndex].nameSprite.material as THREE.SpriteMaterial).opacity = 1.0;
      this.humanBidders[seatIndex].nameSprite.scale.set(2.0, 0.56, 1);
    }

    // 2. AUCTIONEER ANIMATION: Strikes gavel down on rostrum!
    if (this.auctioneer) {
      this.auctioneer.gavelTimer = 1.2;
    }

    // 3. Shockwave ring expanding across floor from bidder to stage
    const pulseGeom = new THREE.RingGeometry(0.25, 0.75, 36);
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
      targetPos: new THREE.Vector3(2.4, 0.45, -7.5),
      progress: 0,
      duration: 1.6,
      maxRadius: 12.0,
    });

    // 4. Smooth cinematic camera ease
    if (!this.reducedMotion) {
      this.isCinematicPanning = true;
      this.panTimer = 2.2;
      this.panTargetPos.set(seatPos.x * 0.4, 4.6, seatPos.z + 5.5);
      this.panTargetLookAt.set(0, 2.8, -6.5);
    }
  }

  public triggerRejectedBidFeedback(): void {
    this.flickerTimer = 0.45;
    this.lotSpotLight.intensity = 0.9;
  }

  public triggerAntiSnipeExtension(): void {
    this.extensionFlashProgress = 1.0;
  }

  public setCountdown(remainingMs: number, totalDurationMs = 1500000): void {
    const ratio = Math.max(0, Math.min(1, remainingMs / totalDurationMs));
    this.countdownProgress = ratio;
  }

  public setConnectedState(connected: boolean): void {
    if (connected) {
      this.lightColorTarget.setHex(0xfffaee);
      this.lightIntensityTarget = 3.6;
      this.ambientLight.intensity = 2.9;
      this.odometer.setDimState(false);
      for (const cl of this.chandelierLights) cl.intensity = 2.2;
    } else {
      // Amber emergency standby lighting on disconnect
      this.lightColorTarget.setHex(0xb36b00);
      this.lightIntensityTarget = 0.8;
      this.ambientLight.intensity = 0.9;
      this.odometer.setDimState(true);
      for (const cl of this.chandelierLights) cl.intensity = 0.4;
    }
  }

  public toggleMotion(): boolean {
    this.reducedMotion = !this.reducedMotion;
    this.controls.autoRotate = !this.reducedMotion;
    return !this.reducedMotion;
  }

  // Camera Presets
  public setCameraView(view: 'saleroom' | 'stage' | 'bidders'): void {
    if (view === 'saleroom') {
      this.camera.position.set(5.2, 5.0, 12.0);
      this.controls.target.set(-0.4, 2.2, -4.5);
    } else if (view === 'stage') {
      this.camera.position.set(0, 3.4, -2.0);
      this.controls.target.set(0.8, 3.0, -8.0);
    } else if (view === 'bidders') {
      this.camera.position.set(0, 3.6, -7.5);
      this.controls.target.set(0, 1.4, 0.0);
    }
  }

  private onPointerDown(event: PointerEvent): void {
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
    // 1. Kinetic Orrery
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

    // 2. Animated Human Bidders: Paddle Raising & Idle Respiration
    for (const b of this.humanBidders) {
      b.idlePhase += delta * 1.5;

      // Subtle breathing motion on torso and head
      b.headGroup.position.y = 1.62 + Math.sin(b.idlePhase) * 0.012;

      if (b.paddleRaiseTimer > 0) {
        b.paddleRaiseTimer -= delta;
        // Raise paddle high into the air facing the stage!
        b.shoulderPivot.rotation.x = THREE.MathUtils.lerp(b.shoulderPivot.rotation.x, -1.45, delta * 8.5);
      } else {
        // Return paddle to resting position on desk
        b.shoulderPivot.rotation.x = THREE.MathUtils.lerp(b.shoulderPivot.rotation.x, 0, delta * 4.0);
      }
    }

    // 3. Auctioneer Gavel Strike Animation
    if (this.auctioneer) {
      if (this.auctioneer.gavelTimer > 0) {
        this.auctioneer.gavelTimer -= delta;
        // Gavel strike downward
        this.auctioneer.gavelArm.rotation.x = -1.25 + Math.sin(this.auctioneer.gavelTimer * 14) * 0.65;
      } else {
        this.auctioneer.gavelArm.rotation.x = THREE.MathUtils.lerp(this.auctioneer.gavelArm.rotation.x, 0, delta * 5.0);
      }
    }

    // 4. Lighting Transitions
    this.lotSpotLight.color.lerp(this.lightColorTarget, delta * 3.5);
    if (this.flickerTimer > 0) {
      this.flickerTimer -= delta;
      if (this.flickerTimer <= 0) {
        this.lotSpotLight.intensity = this.lightIntensityTarget;
      }
    } else {
      this.lotSpotLight.intensity = THREE.MathUtils.lerp(
        this.lotSpotLight.intensity,
        this.lightIntensityTarget,
        delta * 3.5
      );
    }

    // 5. Countdown Ring Scaling on Stage
    let targetRadius = 1.0 + this.countdownProgress * 0.45;
    if (this.extensionFlashProgress > 0) {
      this.extensionFlashProgress -= delta * 1.8;
      if (this.extensionFlashProgress < 0) this.extensionFlashProgress = 0;
      targetRadius += Math.sin(this.extensionFlashProgress * Math.PI) * 0.4;
    }
    this.countdownRingMesh.scale.set(targetRadius, targetRadius, targetRadius);

    // 6. Update Odometer Numerals
    this.odometer.update(delta);

    // 7. Active Bid Shockwave Pulses
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

    // 8. Cinematic Camera Pan
    if (this.isCinematicPanning && !this.reducedMotion) {
      this.panTimer -= delta;
      this.camera.position.lerp(this.panTargetPos, delta * 2.2);
      this.controls.target.lerp(this.panTargetLookAt, delta * 2.2);
      if (this.panTimer <= 0) {
        this.isCinematicPanning = false;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
