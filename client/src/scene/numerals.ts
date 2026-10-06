import * as THREE from 'three';

// 7-segment coordinates for clean mechanical 3D extruded numerals
// Box dimensions per segment: width, height, x, y
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [1.2, 0.22, 0, 1.4],     // top
  b: [0.22, 1.1, 0.65, 0.8],  // top-right
  c: [0.22, 1.1, 0.65, -0.6], // bottom-right
  d: [1.2, 0.22, 0, -1.2],    // bottom
  e: [0.22, 1.1, -0.65, -0.6],// bottom-left
  f: [0.22, 1.1, -0.65, 0.8], // top-left
  g: [1.2, 0.22, 0, 0.1],     // middle
};

// Which segments are active for each digit 0-9
const DIGIT_MAP: Record<string, string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'e', 'd', 'c', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

export class OdometerDisplay {
  public group: THREE.Group;
  private currentCents = 0;
  private currentDisplayGroup: THREE.Group | null = null;
  private rollingOutGroup: THREE.Group | null = null;
  private rollProgress = 1; // 1 = settled, < 1 = in animation
  private goldMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xe2b043,
      metalness: 0.85,
      roughness: 0.25,
      emissive: 0x5a3e10,
      emissiveIntensity: 0.35,
    });
  }

  private createCharMesh(char: string): THREE.Group {
    const charGroup = new THREE.Group();

    if (char === '$') {
      // Create dollar symbol mesh: vertical bar + 5 segments
      const vGeom = new THREE.BoxGeometry(0.18, 3.2, 0.3);
      const vMesh = new THREE.Mesh(vGeom, this.goldMaterial);
      charGroup.add(vMesh);

      for (const seg of ['a', 'f', 'g', 'c', 'd']) {
        const [w, h, x, y] = SEGMENTS[seg];
        const g = new THREE.BoxGeometry(w, h, 0.25);
        const m = new THREE.Mesh(g, this.goldMaterial);
        m.position.set(x, y, 0);
        charGroup.add(m);
      }
      return charGroup;
    }

    if (char === '.') {
      const dotGeom = new THREE.BoxGeometry(0.3, 0.3, 0.25);
      const dotMesh = new THREE.Mesh(dotGeom, this.goldMaterial);
      dotMesh.position.set(0, -1.1, 0);
      charGroup.add(dotMesh);
      return charGroup;
    }

    if (char === ',') {
      const dotGeom = new THREE.BoxGeometry(0.25, 0.45, 0.25);
      const dotMesh = new THREE.Mesh(dotGeom, this.goldMaterial);
      dotMesh.position.set(0, -1.3, 0);
      dotMesh.rotation.z = -0.3;
      charGroup.add(dotMesh);
      return charGroup;
    }

    const segKeys = DIGIT_MAP[char] || [];
    for (const seg of segKeys) {
      const [w, h, x, y] = SEGMENTS[seg];
      const geom = new THREE.BoxGeometry(w, h, 0.25);
      const mesh = new THREE.Mesh(geom, this.goldMaterial);
      mesh.position.set(x, y, 0);
      charGroup.add(mesh);
    }

    return charGroup;
  }

  private buildPriceMeshGroup(cents: number): THREE.Group {
    const container = new THREE.Group();
    const dollars = (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const text = `$${dollars}`;

    const spacing = 1.9;
    const totalWidth = text.length * spacing;
    let startX = -totalWidth / 2 + spacing / 2;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const charMesh = this.createCharMesh(ch);
      charMesh.position.x = startX;
      container.add(charMesh);

      if (ch === '.' || ch === ',') {
        startX += spacing * 0.55;
      } else {
        startX += spacing;
      }
    }

    // Scale overall group to fit aesthetically above pedestal
    container.scale.set(0.45, 0.45, 0.45);
    return container;
  }

  public setValue(cents: number, immediate = false): void {
    if (cents === this.currentCents && this.currentDisplayGroup) return;

    this.currentCents = cents;
    const newGroup = this.buildPriceMeshGroup(cents);

    if (immediate || !this.currentDisplayGroup) {
      if (this.currentDisplayGroup) {
        this.group.remove(this.currentDisplayGroup);
      }
      this.currentDisplayGroup = newGroup;
      this.currentDisplayGroup.position.set(0, 0, 0);
      this.currentDisplayGroup.rotation.x = 0;
      this.group.add(this.currentDisplayGroup);
      this.rollProgress = 1;
      return;
    }

    // Odometer roll animation:
    // Move existing group out, roll new group in
    if (this.rollingOutGroup) {
      this.group.remove(this.rollingOutGroup);
    }
    this.rollingOutGroup = this.currentDisplayGroup;
    this.currentDisplayGroup = newGroup;

    // Start incoming group above with downward rotation
    this.currentDisplayGroup.position.y = 1.6;
    this.currentDisplayGroup.rotation.x = Math.PI / 2;
    this.group.add(this.currentDisplayGroup);

    this.rollProgress = 0;
  }

  public update(delta: number): void {
    if (this.rollProgress < 1) {
      // Animate odometer roll smoothly
      this.rollProgress += delta * 3.5;
      if (this.rollProgress > 1) this.rollProgress = 1;

      // Ease out cubic
      const t = 1 - Math.pow(1 - this.rollProgress, 3);

      if (this.rollingOutGroup) {
        this.rollingOutGroup.position.y = -1.6 * t;
        this.rollingOutGroup.rotation.x = -Math.PI / 2 * t;
        if (this.rollProgress >= 1) {
          this.group.remove(this.rollingOutGroup);
          this.rollingOutGroup = null;
        }
      }

      if (this.currentDisplayGroup) {
        this.currentDisplayGroup.position.y = 1.6 * (1 - t);
        this.currentDisplayGroup.rotation.x = (Math.PI / 2) * (1 - t);
      }
    }
  }

  public setDimState(dimmed: boolean): void {
    if (dimmed) {
      this.goldMaterial.emissive.setHex(0x221105);
      this.goldMaterial.color.setHex(0x735520);
    } else {
      this.goldMaterial.emissive.setHex(0x5a3e10);
      this.goldMaterial.color.setHex(0xe2b043);
    }
  }
}
