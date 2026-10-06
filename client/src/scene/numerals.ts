import * as THREE from 'three';

// Refined segment definitions with thicker, beveled proportions
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [1.35, 0.28, 0, 1.3],     // top
  b: [0.28, 1.15, 0.65, 0.72], // top-right
  c: [0.28, 1.15, 0.65, -0.62],// bottom-right
  d: [1.35, 0.28, 0, -1.2],    // bottom
  e: [0.28, 1.15, -0.65, -0.62],// bottom-left
  f: [0.28, 1.15, -0.65, 0.72],// top-left
  g: [1.35, 0.28, 0, 0.05],    // middle
};

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
  private rollProgress = 1;
  private goldMaterial: THREE.MeshStandardMaterial;
  private plateMaterial: THREE.MeshStandardMaterial;
  private brassMaterial: THREE.MeshStandardMaterial;
  private plateMesh: THREE.Mesh;
  private numeralGlowLight: THREE.PointLight;

  constructor() {
    this.group = new THREE.Group();

    // High-specular luxury gold material
    this.goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.92,
      roughness: 0.15,
      emissive: 0xd4a017,
      emissiveIntensity: 0.55,
    });

    // Dark brushed bronze backplate
    this.plateMaterial = new THREE.MeshStandardMaterial({
      color: 0x14100c,
      metalness: 0.8,
      roughness: 0.35,
    });

    // Antique brass framing
    this.brassMaterial = new THREE.MeshStandardMaterial({
      color: 0xc89d42,
      metalness: 0.9,
      roughness: 0.25,
    });

    // Mounting display backplate
    const plateGeom = new THREE.BoxGeometry(6.4, 2.2, 0.15);
    this.plateMesh = new THREE.Mesh(plateGeom, this.plateMaterial);
    this.plateMesh.position.z = -0.15;
    this.group.add(this.plateMesh);

    // Brass frame trim
    const frameGeom = new THREE.BoxGeometry(6.55, 2.35, 0.1);
    const frameMesh = new THREE.Mesh(frameGeom, this.brassMaterial);
    frameMesh.position.z = -0.22;
    this.group.add(frameMesh);

    // Dedicated warm glow pointlight illuminating numerals
    this.numeralGlowLight = new THREE.PointLight(0xffdf80, 2.0, 5, 1.2);
    this.numeralGlowLight.position.set(0, 0, 0.8);
    this.group.add(this.numeralGlowLight);

    // Initialize with starter value so it is never an empty box
    this.setValue(5000, true);
  }

  private createCharMesh(char: string): THREE.Group {
    const charGroup = new THREE.Group();

    if (char === '$') {
      const vGeom = new THREE.BoxGeometry(0.24, 3.0, 0.35);
      const vMesh = new THREE.Mesh(vGeom, this.goldMaterial);
      charGroup.add(vMesh);

      for (const seg of ['a', 'f', 'g', 'c', 'd']) {
        const [w, h, x, y] = SEGMENTS[seg];
        const g = new THREE.BoxGeometry(w, h, 0.32);
        const m = new THREE.Mesh(g, this.goldMaterial);
        m.position.set(x, y, 0);
        charGroup.add(m);
      }
      return charGroup;
    }

    if (char === '.') {
      const dotGeom = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      const dotMesh = new THREE.Mesh(dotGeom, this.goldMaterial);
      dotMesh.position.set(0, -1.05, 0);
      charGroup.add(dotMesh);
      return charGroup;
    }

    if (char === ',') {
      const dotGeom = new THREE.BoxGeometry(0.3, 0.5, 0.35);
      const dotMesh = new THREE.Mesh(dotGeom, this.goldMaterial);
      dotMesh.position.set(0, -1.2, 0);
      dotMesh.rotation.z = -0.3;
      charGroup.add(dotMesh);
      return charGroup;
    }

    const segKeys = DIGIT_MAP[char] || [];
    for (const seg of segKeys) {
      const [w, h, x, y] = SEGMENTS[seg];
      const geom = new THREE.BoxGeometry(w, h, 0.32);
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

    const spacing = 1.95;
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

    // Adapt backplate width dynamically
    const requiredWidth = Math.max(5.8, (totalWidth + 1.2) * 0.48);
    this.plateMesh.scale.x = requiredWidth / 6.4;

    container.scale.set(0.48, 0.48, 0.48);
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
      this.currentDisplayGroup.position.set(0, 0, 0.05);
      this.currentDisplayGroup.rotation.x = 0;
      this.group.add(this.currentDisplayGroup);
      this.rollProgress = 1;
      return;
    }

    // Odometer roll animation
    if (this.rollingOutGroup) {
      this.group.remove(this.rollingOutGroup);
    }
    this.rollingOutGroup = this.currentDisplayGroup;
    this.currentDisplayGroup = newGroup;

    this.currentDisplayGroup.position.set(0, 1.8, 0.05);
    this.currentDisplayGroup.rotation.x = Math.PI / 2;
    this.group.add(this.currentDisplayGroup);

    this.rollProgress = 0;

    // Flash light during roll
    this.numeralGlowLight.intensity = 4.0;
  }

  public update(delta: number): void {
    if (this.rollProgress < 1) {
      this.rollProgress += delta * 4.2;
      if (this.rollProgress > 1) this.rollProgress = 1;

      // Elastic/cubic ease
      const t = 1 - Math.pow(1 - this.rollProgress, 3);

      if (this.rollingOutGroup) {
        this.rollingOutGroup.position.y = -1.8 * t;
        this.rollingOutGroup.rotation.x = (-Math.PI / 2) * t;
        if (this.rollProgress >= 1) {
          this.group.remove(this.rollingOutGroup);
          this.rollingOutGroup = null;
        }
      }

      if (this.currentDisplayGroup) {
        this.currentDisplayGroup.position.y = 1.8 * (1 - t);
        this.currentDisplayGroup.rotation.x = (Math.PI / 2) * (1 - t);
      }

      this.numeralGlowLight.intensity = THREE.MathUtils.lerp(
        this.numeralGlowLight.intensity,
        2.0,
        delta * 5
      );
    }
  }

  public setDimState(dimmed: boolean): void {
    if (dimmed) {
      this.goldMaterial.emissive.setHex(0x331a00);
      this.goldMaterial.color.setHex(0x735520);
      this.numeralGlowLight.intensity = 0.4;
      this.numeralGlowLight.color.setHex(0xb36b00);
    } else {
      this.goldMaterial.emissive.setHex(0xd4a017);
      this.goldMaterial.color.setHex(0xffd700);
      this.numeralGlowLight.intensity = 2.0;
      this.numeralGlowLight.color.setHex(0xffdf80);
    }
  }
}
