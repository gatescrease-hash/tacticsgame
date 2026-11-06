/**
 * 2.5D battle renderer (three.js). Pure presentation: it reads the same playback
 * state the 2D canvas draws (interpolated positions, HP, statuses, floaters,
 * bubbles) plus battle-log events for animation cues. It never touches the sim.
 *
 * Diorama tiles with height, orbit/pitch/zoom camera, low-poly units built from
 * primitives, idle bobs, hops, projectiles, hit flashes and knockouts.
 *
 * Attacks are "deform" animations, no rigs: the whole model squashes, stretches,
 * leans, twists and lunges through a wind-up and a strike, shaped by the attack's
 * style (slash, thrust, smash, shoot, cast, pounce, support, shout). Targets react
 * (knockback, sidestep, block sparks), statuses get little auras, and big moments
 * nudge the camera.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { content } from "../content/index.js";
import type { BattleEvent, UnitSnapshot } from "../sim/index.js";
import { abilityElement, attackStyle, type AttackStyle } from "./sound.js";

export interface ViewUnit extends UnitSnapshot {
  /** Interpolated tile position. */
  x: number;
  y: number;
  moveStart: number;
  moveEnd: number;
  alive: boolean;
  statuses: Map<string, string>;
}

export interface ViewState {
  units: Map<number, ViewUnit>;
  current: number | null;
  floaters: { uid: number; text: string; color: string; start: number; until: number }[];
  bubbles: { uid: number; text: string; until: number }[];
}

export interface Theme {
  background: string;
  player: string;
  enemy: string;
  text: string;
  panel: string;
}

// ------------------------------------------------------------------ terrain

interface TileLook {
  height: number;
  color: number;
}

/** World units per metre of elevation (a tile is 1 world unit wide). */
const METRE = 0.5;

const TILE_LOOK: Record<string, TileLook> = {
  ".": { height: 0.3, color: 0x9bb07a },
  "#": { height: 0.8, color: 0x8a8378 },
  "~": { height: 0.16, color: 0x5d6f52 },
  '"': { height: 0.32, color: 0x7f9a5c },
};

/** Deterministic per-tile noise in [0, 1). */
function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(salt + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(color: number, amount: number): THREE.Color {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
}

// ------------------------------------------------------------------ unit models

/** Models are built at roughly 1 unit = 1 tile; this makes them read better from orbit distance. */
const UNIT_SCALE = 1.3;

const SKIN: Record<string, number> = {
  human: 0xe8c39e,
  lizardfolk: 0x6f9e52,
  wolf: 0x8d8a85,
  golem: 0x8b8780,
  steamwork: 0xb08d4a,
  mudling: 0x6e5235,
  winged: 0xf0d2b0,
  harpy: 0x9a7b5a,
};

const FLYERS = new Set(["winged", "harpy"]);

/** A pair of flat, low-poly wings, tagged so the renderer can flap them. */
function addWings(g: THREE.Group, color: number, span: number, y: number, z: number): void {
  const feather = mat(color, { side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(span, 0.12);
    shape.lineTo(span * 0.85, -0.12);
    shape.lineTo(span * 0.45, -0.2);
    shape.lineTo(0, -0.1);
    const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape), feather);
    wing.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(0.06 * side, y, z);
    pivot.scale.x = side;
    pivot.add(wing);
    pivot.userData.wing = side;
    g.add(pivot);
  }
}

function mat(color: number | THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra });
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A unit's model, built from primitives. Faces +Z. Body parts tagged for flashing. */
function buildModel(u: UnitSnapshot, teamColor: number): THREE.Group {
  const g = new THREE.Group();
  const team = mat(teamColor);
  const skin = mat(SKIN[u.raceId] ?? 0xe8c39e);
  const dark = mat(0x3b3631);
  const metal = mat(0xb9bcc2, { metalness: 0.5, roughness: 0.4 });
  const wood = mat(0x7a5532);
  const cls = u.classId;

  if (u.raceId === "wolf") {
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.22, 0.5), skin, 0, 0.26, 0));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.18, 0.22), skin, 0, 0.36, 0.3));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), dark, 0, 0.32, 0.43));
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.ConeGeometry(0.04, 0.1, 4), skin, 0.06 * s, 0.49, 0.26));
      for (const z of [-0.17, 0.17]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), skin, 0.09 * s, 0.08, z));
    }
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.22, 4).rotateX(-1.2), skin, 0, 0.32, -0.3));
    g.add(mesh(new THREE.TorusGeometry(0.12, 0.025, 4, 8), team, 0, 0.32, 0.19));
    return g;
  }
  if (u.raceId === "golem") {
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.36), skin, 0, 0.45, 0));
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.2, 0.24), skin, 0, 0.82, 0.03));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), mat(0x8fd3ff, { emissive: 0x3aa0ff, emissiveIntensity: 1 }), 0, 0.84, 0.16));
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.42, 0.18), skin, 0.36 * s, 0.4, 0));
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.22, 0.18), skin, 0.13 * s, 0.11, 0));
    }
    g.add(mesh(new THREE.BoxGeometry(0.52, 0.06, 0.38), team, 0, 0.66, 0));
    return g;
  }
  if (u.raceId === "steamwork") {
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.48, 7), skin, 0, 0.36, 0));
    g.add(mesh(new THREE.BoxGeometry(0.24, 0.18, 0.22), skin, 0, 0.7, 0));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.04, 0.02), mat(0xffb35a, { emissive: 0xff7a1a, emissiveIntensity: 1.2 }), 0, 0.72, 0.12));
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 6), dark, -0.12, 0.82, -0.08));
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6).rotateZ(Math.PI / 2), metal, 0.3, 0.44, 0.04));
    g.add(mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 7), team, 0, 0.5, 0));
    return g;
  }
  if (u.raceId === "harpy") {
    const body = mesh(new THREE.IcosahedronGeometry(0.17, 0), skin, 0, 0.42, 0);
    body.scale.set(1, 0.9, 1.25);
    g.add(body);
    g.add(mesh(new THREE.IcosahedronGeometry(0.1, 0), mat(0xe2c8a8), 0, 0.62, 0.12));
    g.add(mesh(new THREE.ConeGeometry(0.035, 0.1, 4).rotateX(Math.PI / 2), mat(0xd9a640), 0, 0.6, 0.24));
    g.add(mesh(new THREE.ConeGeometry(0.07, 0.22, 4).rotateX(-1.3), skin, 0, 0.38, -0.25));
    for (const s of [-1, 1]) g.add(mesh(new THREE.ConeGeometry(0.03, 0.14, 3).rotateX(Math.PI), mat(0x3b3631), 0.07 * s, 0.24, 0.02));
    g.add(mesh(new THREE.TorusGeometry(0.1, 0.025, 4, 8), team, 0, 0.5, 0.06));
    addWings(g, 0x7a5c40, 0.5, 0.5, -0.02);
    return g;
  }
  if (u.raceId === "mudling") {
    const blob = mesh(new THREE.IcosahedronGeometry(0.3, 1), skin, 0, 0.3, 0);
    blob.scale.set(1.1, 0.85, 1);
    g.add(blob);
    for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.04, 5, 4), mat(0xf2e3b0), 0.1 * s, 0.4, 0.25));
    g.add(mesh(new THREE.TorusGeometry(0.24, 0.03, 4, 10).rotateX(Math.PI / 2), team, 0, 0.12, 0));
    return g;
  }

  // Humanoids: legs, torso in team colour, head, then class gear.
  const heavy = cls === "knight" || cls === "brute" || cls === "sergeant";
  const bodyW = heavy ? 0.24 : 0.2;
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.09), dark, 0.07 * s, 0.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(bodyW * 0.8, bodyW, 0.34, 6), team, 0, 0.36, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), skin, 0, 0.64, 0));
  if (u.raceId === "lizardfolk") g.add(mesh(new THREE.ConeGeometry(0.06, 0.26, 4).rotateX(-1.1), skin, 0, 0.18, -0.2));
  if (u.raceId === "winged") addWings(g, 0xf4f1ea, 0.45, 0.48, -0.12);

  const hand = (side: number, obj: THREE.Object3D) => {
    obj.position.x += 0.22 * side;
    obj.position.y += 0.36;
    g.add(obj);
  };
  switch (cls) {
    case "knight":
    case "sergeant":
      g.add(mesh(new THREE.ConeGeometry(0.13, 0.12, 6), metal, 0, 0.76, 0));
      hand(-1, mesh(new THREE.BoxGeometry(0.05, 0.3, 0.24), metal, -0.02, 0, 0.04));
      hand(1, mesh(new THREE.BoxGeometry(0.03, 0.42, 0.05), metal, 0, 0.14, 0.06));
      break;
    case "brute":
      hand(1, mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 5), wood, 0, 0.1, 0.06));
      hand(1, mesh(new THREE.DodecahedronGeometry(0.08, 0), metal, 0, 0.3, 0.06));
      break;
    case "duelist":
    case "skirmisher":
      g.add(mesh(new THREE.ConeGeometry(0.14, 0.08, 6), team, 0, 0.73, 0));
      hand(1, mesh(new THREE.BoxGeometry(0.02, 0.3, 0.03), metal, 0, 0.1, 0.1));
      break;
    case "archer":
    case "crossbowman": {
      const bow = mesh(new THREE.TorusGeometry(0.2, 0.015, 3, 10, Math.PI), wood);
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
      hand(-1, bow);
      g.add(mesh(new THREE.ConeGeometry(0.13, 0.1, 6), mat(0x4f6b3a), 0, 0.73, 0));
      break;
    }
    case "pyromancer":
    case "stormcaller":
    case "tactician": {
      const hat = cls === "pyromancer" ? 0xb5402a : cls === "stormcaller" ? 0x2f6fa8 : 0x6a4c93;
      g.add(mesh(new THREE.ConeGeometry(0.15, 0.32, 6), mat(hat), 0, 0.86, 0));
      hand(1, mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), wood, 0, 0.12, 0.04));
      hand(1, mesh(new THREE.OctahedronGeometry(0.05, 0), mat(hat, { emissive: hat, emissiveIntensity: 0.8 }), 0, 0.44, 0.04));
      break;
    }
    case "cleric":
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 6), mat(0xf1ece0), 0, 0.74, 0));
      hand(1, mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), wood, 0, 0.08, 0.05));
      hand(1, mesh(new THREE.DodecahedronGeometry(0.06, 0), mat(0xe0c060, { metalness: 0.6 }), 0, 0.24, 0.05));
      break;
    case "spearman":
    case "sandstalker":
      hand(1, mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5), wood, 0, 0.12, 0.05));
      hand(1, mesh(new THREE.ConeGeometry(0.035, 0.12, 4), metal, 0, 0.62, 0.05));
      break;
    default:
      break;
  }
  return g;
}

// ------------------------------------------------------------------ effects

interface Fx {
  until: number;
  update(now: number): void;
  dispose(): void;
}

/** A timed animation on a unit (times in ms of performance.now()). */
interface Anim {
  start: number;
  end: number;
}

interface UnitView {
  root: THREE.Group;
  model: THREE.Group;
  /** Smoothed facing (the model's yaw before attack twists). */
  facing: number;
  ring: THREE.Mesh;
  /** Soft disc on the ground under flyers. */
  shadow: THREE.Mesh;
  hpBack: THREE.Mesh;
  hpFill: THREE.Mesh;
  phase: number;
  yaw: number;
  /** Animation cues. */
  action: (Anim & { style: AttackStyle; dir: THREE.Vector3; color: THREE.Color }) | null;
  react: (Anim & { kind: "knock" | "dodge" | "block"; dir: THREE.Vector3; amp: number }) | null;
  flash: (Anim & { color: THREE.Color }) | null;
  ko: { start: number } | null;
  materials: THREE.MeshStandardMaterial[];
  /** Status effects shown around the unit, by status id. */
  auras: Map<string, Aura>;
}

interface Aura {
  kind: "orbit" | "rise" | "fall" | "ring";
  bits: THREE.Mesh[];
}

/** Status visuals: what moves around a unit while it has the status. */
const AURAS: Record<string, { kind: Aura["kind"]; color: number; n: number }> = {
  stunned: { kind: "orbit", color: 0xffe066, n: 3 },
  shaken: { kind: "orbit", color: 0xb9a6e0, n: 2 },
  burning: { kind: "rise", color: 0xff7a2a, n: 4 },
  poisoned: { kind: "rise", color: 0x7ddc5a, n: 3 },
  frenzy: { kind: "rise", color: 0xe0412f, n: 3 },
  bleeding: { kind: "fall", color: 0xb3202a, n: 3 },
  wet: { kind: "fall", color: 0x6fc3ff, n: 3 },
  rallied: { kind: "ring", color: 0xf2c94c, n: 1 },
  hasted: { kind: "ring", color: 0x7fe3ff, n: 1 },
  slowed: { kind: "ring", color: 0x5b7bd6, n: 1 },
};

/** Wind-up rises to 1 by 35% of an attack, snaps back by ~47%. */
function windup(f: number): number {
  return f < 0.35 ? Math.sin((f / 0.35) * Math.PI * 0.5) : Math.max(0, 1 - (f - 0.35) / 0.12);
}
/** Strike peaks at 50% of an attack (sharp in), then eases out. */
function strike(f: number): number {
  if (f < 0.35) return 0;
  if (f < 0.5) return (f - 0.35) / 0.15;
  return Math.max(0, 1 - (f - 0.5) / 0.5) ** 1.5;
}
/** Reaction envelope: sharp hit, slow settle. */
function jolt(f: number): number {
  return f < 0.12 ? f / 0.12 : Math.max(0, 1 - (f - 0.12) / 0.88) ** 2;
}

export class Battle3D {
  readonly ok: boolean;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private overlay: HTMLDivElement;
  private units = new Map<number, UnitView>();
  private fx: Fx[] = [];
  private width: number;
  private height: number;
  private resize: ResizeObserver;
  private labelCache = new Map<string, HTMLDivElement>();
  private tmp = new THREE.Vector3();
  private shake: (Anim & { amp: number }) | null = null;
  /** When a projectile aimed at a unit lands, so its hit reaction can wait for it. */
  private impactAt = new Map<number, number>();

  private metres: number[][];

  constructor(
    private host: HTMLElement,
    private map: string[],
    snapshots: UnitSnapshot[],
    private theme: Theme,
    heights?: string[],
  ) {
    this.metres = map.map((row, y) => [...row].map((_, x) => Number(heights?.[y]?.[x] ?? 0)));
    this.width = map[0]!.length;
    this.height = map.length;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay3d";
    this.resize = new ResizeObserver(() => this.fit());
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      this.ok = false;
      return;
    }
    this.ok = true;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.replaceChildren(this.renderer.domElement, this.overlay);

    this.scene.background = new THREE.Color(theme.background);
    this.buildTerrain();
    this.buildLights();
    for (const u of snapshots) this.addUnit(u);

    const span = Math.max(this.width, this.height);
    this.camera.position.set(-span * 0.28, span * 0.8, span * 0.88);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minDistance = span * 0.35;
    this.controls.maxDistance = span * 1.8;
    this.controls.update();

    this.resize.observe(host);
    this.fit();
  }

  /** World position of a tile centre (x right, z down the map). */
  private world(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(x - this.width / 2 + 0.5, 0, y - this.height / 2 + 0.5);
  }

  /** Ground surface height (world units) of one tile. */
  private tileTop(x: number, y: number): number {
    const ch = this.map[y]?.[x] ?? ".";
    // Over a pit, flyers hover at the level of the surrounding ground.
    const base = ch === "~" ? 0.2 : ch === "O" ? 0.3 : (TILE_LOOK[ch] ?? TILE_LOOK["."]!).height;
    return base + (this.metres[y]?.[x] ?? 0) * METRE;
  }

  /** Where a unit stands; mid-move it uses the higher of the two tiles (the hop arcs over steps). */
  private topAt(x: number, y: number): number {
    return Math.max(this.tileTop(Math.floor(x), Math.floor(y)), this.tileTop(Math.ceil(x), Math.ceil(y)));
  }

  private buildTerrain(): void {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(this.width + 0.6, 0.5, this.height + 0.6), mat(0x5a4636));
    slab.position.y = -0.25;
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.map.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const p = this.world(x, y);
        if (ch === "O") {
          // Bottomless pit: a dark hole between the neighbouring columns.
          const hole = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.02, 0.99), new THREE.MeshBasicMaterial({ color: 0x07070a }));
          hole.position.set(p.x, 0.01, p.z);
          this.scene.add(hole);
          return;
        }
        const look = TILE_LOOK[ch] ?? TILE_LOOK["."]!;
        const lift = (this.metres[y]?.[x] ?? 0) * METRE;
        if (lift > 0) {
          // Raised ground: a rock column under the tile's own surface.
          const rock = new THREE.Mesh(new THREE.BoxGeometry(0.99, lift, 0.99), mat(shade(0x8a7a66, (hash(x, y, 8) - 0.5) * 0.08)));
          rock.position.set(p.x, lift / 2, p.z);
          rock.receiveShadow = true;
          rock.castShadow = true;
          this.scene.add(rock);
        }
        const h = look.height + (ch === "#" ? hash(x, y) * 0.2 : hash(x, y) * 0.05);
        const tile = new THREE.Mesh(new THREE.BoxGeometry(0.97, h, 0.97), mat(shade(look.color, (hash(x, y, 1) - 0.5) * 0.08 + lift * 0.06)));
        tile.position.set(p.x, lift + h / 2, p.z);
        tile.receiveShadow = true;
        tile.castShadow = ch === "#" || lift > 0;
        this.scene.add(tile);
        if (ch === "~") {
          const water = new THREE.Mesh(
            new THREE.BoxGeometry(0.97, 0.06, 0.97),
            new THREE.MeshStandardMaterial({ color: 0x4f8fa6, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0.1 }),
          );
          water.position.set(p.x, lift + 0.2, p.z);
          water.receiveShadow = true;
          this.scene.add(water);
        }
        if (ch === '"') {
          for (let i = 0; i < 3; i++) {
            const bush = new THREE.Mesh(new THREE.ConeGeometry(0.16 + hash(x, y, i) * 0.06, 0.45 + hash(x, y, i + 5) * 0.2, 5), mat(shade(0x3f6b34, hash(x, y, i + 9) * 0.08)));
            bush.position.set(p.x + (hash(x, y, i + 2) - 0.5) * 0.55, lift + h + 0.22, p.z + (hash(x, y, i + 3) - 0.5) * 0.55);
            bush.castShadow = true;
            this.scene.add(bush);
          }
        }
        if (ch === "#" && hash(x, y, 7) > 0.6) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), mat(0x9a9388));
          rock.position.set(p.x + 0.15, lift + h + 0.08, p.z - 0.1);
          rock.castShadow = true;
          this.scene.add(rock);
        }
        if (ch === "." && hash(x, y, 4) > 0.82) {
          const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 3), mat(0x6f8f4f));
          tuft.position.set(p.x + (hash(x, y, 5) - 0.5) * 0.6, lift + h + 0.06, p.z + (hash(x, y, 6) - 0.5) * 0.6);
          this.scene.add(tuft);
        }
      }),
    );
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x4a3b2c, 1.3));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    const span = Math.max(this.width, this.height);
    sun.position.set(-span * 0.4, span, span * 0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -span;
    s.right = span;
    s.top = span;
    s.bottom = -span;
    s.near = 0.5;
    s.far = span * 4;
    sun.shadow.bias = -0.002;
    this.scene.add(sun);
  }

  private addUnit(u: UnitSnapshot): void {
    const teamColor = new THREE.Color(u.side === "player" ? this.theme.player : this.theme.enemy).getHex();
    const root = new THREE.Group();
    const model = buildModel(u, teamColor);
    // Enemies start facing the player's side.
    const yaw = u.side === "player" ? Math.PI / 2 : -Math.PI / 2;
    // Yaw first, then lean (pitch) and roll in the model's own frame.
    model.rotation.order = "YXZ";
    model.rotation.y = yaw;
    root.add(model);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.38, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.85 }),
    );
    ring.position.y = 0.01;
    root.add(ring);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.26, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.visible = false;
    root.add(shadow);
    const hpBack = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.07), new THREE.MeshBasicMaterial({ color: 0x1b1b1b, depthTest: false }));
    const hpFill = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.05), new THREE.MeshBasicMaterial({ color: 0x4caf50, depthTest: false }));
    hpBack.renderOrder = 10;
    hpFill.renderOrder = 11;
    root.add(hpBack, hpFill);
    this.scene.add(root);
    const materials: THREE.MeshStandardMaterial[] = [];
    model.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material = o.material.clone();
        o.material.userData.baseEmissive = o.material.emissive.clone();
        materials.push(o.material);
      }
    });
    this.units.set(u.uid, {
      root, model, facing: yaw, ring, shadow, hpBack, hpFill, phase: hash(u.uid, 3) * Math.PI * 2, yaw,
      action: null, react: null, flash: null, ko: null, materials, auras: new Map(),
    });
  }

  private fit(): void {
    const w = this.host.clientWidth || this.width * 56;
    const h = Math.round(w * 0.62);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.overlay.style.width = `${w}px`;
    this.overlay.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private unitWorld(v: ViewUnit): THREE.Vector3 {
    const p = this.world(v.x, v.y);
    p.y = this.topAt(v.x, v.y);
    return p;
  }

  /** Animation cues from the battle log. */
  onEvent(e: BattleEvent, now: number, speed: number, view: ViewState): void {
    const sp = Math.max(1, speed);
    switch (e.kind) {
      case "ability": {
        const a = this.units.get(e.uid);
        const att = view.units.get(e.uid);
        const tgt = view.units.get(e.target);
        if (!a || !att || !tgt) return;
        const from = this.unitWorld(att);
        const to = this.unitWorld(tgt);
        const dir = to.clone().sub(from).setY(0);
        const dist = dir.length();
        if (dist > 0.01) a.yaw = Math.atan2(dir.x, dir.z);
        dir.normalize();
        const def = content.abilities[e.ability];
        const ranged = dist > 1.5;
        const style = attackStyle(e.ability, att.weaponId, ranged);
        const color = new THREE.Color(this.abilityColor(e.ability));
        const dur = (style === "cast" || style === "support" || style === "shout" ? 520 : 420) / sp;
        a.action = { start: now, end: now + dur, style, dir, color };
        if (ranged && e.uid !== e.target) {
          // Released at the end of the wind-up; flight time grows with distance.
          const launch = now + dur * 0.4;
          const flight = Math.min(320, 70 + dist * 45) / sp;
          if (style === "shoot") this.arrow(from, to, launch, flight);
          else this.orb(from, to, launch, flight, color.getHex());
          this.impactAt.set(e.target, launch + flight);
        }
        if (style === "smash" && !ranged) this.pulse(to, 0.35, now + dur * 0.5, 360 / sp, 0xc8b28a);
        if (def?.shape.kind === "radius") this.pulse(to, def.shape.r, now + dur * 0.5, 500 / sp, color.getHex());
        if (style === "shout") this.pulse(from, 1.2, now + dur * 0.3, 600 / sp, color.getHex());
        break;
      }
      case "hit": {
        const t = this.units.get(e.target);
        const tv = view.units.get(e.target);
        const av = view.units.get(e.uid);
        if (!t || !tv) return;
        // Ranged hits land when the projectile does.
        const landing = this.impactAt.get(e.target);
        const at = landing !== undefined && landing > now && landing - now < 700 ? landing : now;
        const pos = this.unitWorld(tv);
        const dir = av ? pos.clone().sub(this.unitWorld(av)).setY(0).normalize() : new THREE.Vector3(1, 0, 0);
        const chest = pos.clone().setY(pos.y + 0.45);
        if (e.damage > 0) {
          const amp = e.crit ? 1.7 : 1;
          t.flash = { start: at, end: at + 260 / sp, color: new THREE.Color(e.crit ? 0xff2020 : 0xff6a3a) };
          t.react = { start: at, end: at + 380 / sp, kind: "knock", dir, amp };
          this.burst(chest, this.damageColor(e.components[0]?.type), e.crit ? 14 : 7, e.crit ? 2.4 : 1.6, at, 420 / sp);
          if (e.crit) this.shakeCamera(at, 260 / sp, 0.07);
        } else if (e.outcome === "missed" || e.outcome === "dodged") {
          t.react = { start: at, end: at + 320 / sp, kind: "dodge", dir, amp: e.outcome === "dodged" ? 1 : 0.5 };
        } else {
          // Parried, blocked, glanced off: sparks where the blow met the guard, both sides rock back.
          t.react = { start: at, end: at + 260 / sp, kind: "block", dir, amp: 1 };
          const a = this.units.get(e.uid);
          if (a && av && Math.abs(av.x - tv.x) + Math.abs(av.y - tv.y) <= 1.5) a.react = { start: at, end: at + 260 / sp, kind: "block", dir: dir.clone().negate(), amp: 0.6 };
          this.burst(chest.clone().addScaledVector(dir, -0.3), 0xfff0b0, 9, 2, at, 300 / sp);
        }
        break;
      }
      case "heal": {
        const t = this.units.get(e.target);
        const v = view.units.get(e.target);
        if (t) t.flash = { start: now, end: now + 400 / sp, color: new THREE.Color(0x5cff7a) };
        if (v) this.sparkle(this.unitWorld(v), now, 700 / sp, 0x7dffa0);
        break;
      }
      case "dot": {
        const t = this.units.get(e.uid);
        if (t) t.flash = { start: now, end: now + 200 / sp, color: new THREE.Color(0xff9d4d) };
        break;
      }
      case "status": {
        const v = view.units.get(e.uid);
        if (v && e.on) this.sparkle(this.unitWorld(v), now, 500 / sp, AURAS[e.status]?.color ?? 0xd0b8ff);
        break;
      }
      case "knockout": {
        const t = this.units.get(e.uid);
        const v = view.units.get(e.uid);
        if (t) t.ko = { start: now };
        if (v) {
          const p = this.unitWorld(v);
          this.burst(p.clone().setY(p.y + 0.1), 0xb9a78a, 12, 1.2, now + 350, 600);
          this.shakeCamera(now + 350, 220, 0.04);
        }
        break;
      }
      default:
        break;
    }
  }

  private damageColor(type: string | undefined): number {
    switch (type) {
      case "fire":
        return 0xff7a2a;
      case "lightning":
        return 0xfff27a;
      case "psychic":
        return 0xd06cff;
      case "spirit":
        return 0xfff6c8;
      case "slashing":
        return 0xffd0b0;
      case "piercing":
        return 0xfff0e0;
      default:
        return 0xe8dcc8;
    }
  }

  private shakeCamera(start: number, dur: number, amp: number): void {
    if (this.shake && this.shake.end > start && this.shake.amp >= amp) return;
    this.shake = { start, end: start + dur, amp };
  }

  private abilityColor(id: string): number {
    const def = content.abilities[id];
    const type = def?.effects.find((x) => x.kind === "damage");
    if (def?.tags.includes("heal")) return 0x7dffa0;
    if (!type || type.kind !== "damage") return 0xd8d0ff;
    const c = type.packet[0];
    if (c?.element === "water") return 0x6fc3ff;
    if (c?.element === "wind") return 0xd8f5ff;
    switch (c?.type) {
      case "fire":
        return 0xff7a2a;
      case "lightning":
        return 0xfff27a;
      case "psychic":
        return 0xd06cff;
      case "spirit":
        return 0xfff6c8;
      default:
        return 0xf0e6d0;
    }
  }

  /** An arrow (or bolt, or javelin) on a shallow arc, nose following its flight. */
  private arrow(from: THREE.Vector3, to: THREE.Vector3, start: number, dur: number): void {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.46, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a6a45 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    tip.position.z = 0.27;
    g.add(shaft, tip);
    g.visible = false;
    const a = from.clone().setY(from.y + 0.5);
    const b = to.clone().setY(to.y + 0.45);
    const arc = 0.15 + a.distanceTo(b) * 0.06;
    const at = (f: number) => new THREE.Vector3().lerpVectors(a, b, f).setY(a.y + (b.y - a.y) * f + Math.sin(Math.PI * f) * arc);
    this.scene.add(g);
    this.fx.push({
      until: start + dur,
      update: (t) => {
        if (t < start) return;
        const f = Math.min(1, (t - start) / dur);
        g.visible = f < 1;
        g.position.copy(at(f));
        g.lookAt(at(Math.min(1, f + 0.05)));
      },
      dispose: () => {
        this.scene.remove(g);
        shaft.geometry.dispose();
        tip.geometry.dispose();
      },
    });
  }

  /** A spell: a glowing orb with a short fading trail. */
  private orb(from: THREE.Vector3, to: THREE.Vector3, start: number, dur: number, color: number): void {
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 * (1 - i * 0.2), 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 - i * 0.22 }));
      m.visible = false;
      this.scene.add(m);
      parts.push(m);
    }
    const a = from.clone().setY(from.y + 0.6);
    const b = to.clone().setY(to.y + 0.45);
    this.fx.push({
      until: start + dur,
      update: (t) => {
        if (t < start) return;
        parts.forEach((m, i) => {
          const f = Math.min(1, Math.max(0, (t - start) / dur - i * 0.07));
          m.visible = f > 0 && t < start + dur;
          m.position.lerpVectors(a, b, f);
          m.position.y += Math.sin(Math.PI * f) * 0.35;
          m.rotation.y += 0.3;
        });
      },
      dispose: () => parts.forEach((m) => (this.scene.remove(m), m.geometry.dispose())),
    });
  }

  /** Shards flying out from a point under gravity: impacts, sparks, dust. */
  private burst(at: THREE.Vector3, color: number, n: number, speed: number, start: number, dur: number): void {
    const bits: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.visible = false;
      this.scene.add(m);
      const ang = (i / n) * Math.PI * 2 + hash(i, n, Math.round(start)) * 0.8;
      const up = 0.4 + hash(i, 7, Math.round(start)) * 0.9;
      bits.push({ m, v: new THREE.Vector3(Math.cos(ang), up, Math.sin(ang)).multiplyScalar(speed * (0.6 + hash(i, 3) * 0.6)) });
    }
    this.fx.push({
      until: start + dur,
      update: (t) => {
        if (t < start) return;
        const s = (t - start) / 1000;
        const f = Math.min(1, (t - start) / dur);
        for (const { m, v } of bits) {
          m.visible = true;
          m.position.set(at.x + v.x * s, at.y + v.y * s - 4.5 * s * s, at.z + v.z * s);
          m.rotation.x += 0.2;
          (m.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        }
      },
      dispose: () => bits.forEach(({ m }) => (this.scene.remove(m), m.geometry.dispose())),
    });
  }

  private pulse(at: THREE.Vector3, r: number, start: number, dur: number, color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.position.set(at.x, at.y + 0.05, at.z);
    this.scene.add(ring);
    this.fx.push({
      until: start + dur,
      update: (t) => {
        const f = Math.max(0, (t - start) / dur);
        const s = 0.3 + f * (r + 0.6);
        ring.scale.set(s, 1, s);
        (ring.material as THREE.MeshBasicMaterial).opacity = t < start ? 0 : 0.8 * (1 - f);
      },
      dispose: () => {
        this.scene.remove(ring);
        ring.geometry.dispose();
      },
    });
  }

  private sparkle(at: THREE.Vector3, now: number, dur: number, color: number): void {
    const bits: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color, transparent: true }));
      this.scene.add(m);
      bits.push(m);
    }
    this.fx.push({
      until: now + dur,
      update: (t) => {
        const f = Math.min(1, (t - now) / dur);
        bits.forEach((m, i) => {
          const ang = (i / bits.length) * Math.PI * 2 + f * 2;
          m.position.set(at.x + Math.cos(ang) * 0.3, at.y + 0.2 + f * 0.7, at.z + Math.sin(ang) * 0.3);
          (m.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        });
      },
      dispose: () => bits.forEach((m) => (this.scene.remove(m), m.geometry.dispose())),
    });
  }

  /**
   * The current attack / reaction deform of a unit: world offsets (dx, dy, dz), lean
   * (pitch, + = forward), twist (extra yaw), roll, local scale (sx, sy, sz; z = forward)
   * and glow (0-1).
   */
  private pose(u: UnitView, now: number) {
    const p = { dx: 0, dy: 0, dz: 0, pitch: 0, twist: 0, roll: 0, sx: 1, sy: 1, sz: 1, glow: 0 };
    const a = u.action;
    if (a && now >= a.start && now < a.end) {
      const f = (now - a.start) / (a.end - a.start);
      const w = windup(f);
      const s = strike(f);
      const fwd = (k: number) => {
        p.dx += a.dir.x * k;
        p.dz += a.dir.z * k;
      };
      switch (a.style) {
        case "slash":
          // Coil the blade back, then whip round through the target.
          p.twist = -1.1 * w + 1.25 * s;
          p.pitch = -0.1 * w + 0.3 * s;
          fwd(-0.08 * w + 0.4 * s);
          break;
        case "thrust":
          // Draw back and compress, then a long stretched jab.
          p.pitch = -0.12 * w + 0.18 * s;
          p.sz = 1 - 0.18 * w + 0.45 * s;
          p.sx = 1 + 0.08 * w - 0.1 * s;
          fwd(-0.15 * w + 0.55 * s);
          break;
        case "smash":
          // Rear up tall, then slam down wide.
          p.sy = 1 + 0.22 * w - 0.3 * s;
          p.sx = p.sz = 1 - 0.08 * w + 0.22 * s;
          p.pitch = -0.3 * w + 0.45 * s;
          p.dy = 0.12 * w;
          fwd(0.25 * s);
          break;
        case "pounce": {
          // Crouch, then leap at the target in an arc, stretched out.
          const leap = f < 0.3 ? 0 : Math.sin(Math.min(1, (f - 0.3) / 0.5) * Math.PI);
          p.sy = 1 - 0.18 * w + 0.05 * leap;
          p.sz = 1 + 0.3 * leap;
          p.pitch = 0.25 * leap - 0.1 * w;
          p.dy = 0.3 * leap;
          fwd(0.55 * leap);
          break;
        }
        case "shoot":
          // Lean into the draw, then recoil on release.
          p.pitch = -0.14 * w;
          p.sz = 1 - 0.1 * w;
          p.roll = 0.12 * w;
          fwd(-0.15 * s);
          break;
        case "cast":
          // Rise and gather (a little twirl and glow), then thrust the spell out.
          p.dy = 0.14 * w + 0.06 * s;
          p.sy = 1 + 0.15 * w;
          p.twist = Math.PI * 2 * Math.min(1, f / 0.45) * (1 - s * 0.2);
          p.pitch = 0.2 * s;
          p.glow = Math.max(w, s);
          fwd(0.12 * s);
          break;
        case "support":
          // Rise up, glowing.
          p.dy = 0.12 * Math.sin(Math.PI * f);
          p.sy = 1 + 0.12 * Math.sin(Math.PI * f);
          p.glow = Math.sin(Math.PI * f);
          break;
        case "shout":
          // Puff up and bellow.
          p.sx = p.sz = 1 + 0.18 * Math.sin(Math.PI * f);
          p.sy = 1 + 0.1 * Math.sin(Math.PI * f);
          p.pitch = -0.2 * Math.sin(Math.PI * f);
          p.glow = 0.5 * Math.sin(Math.PI * f);
          break;
      }
    }
    const r = u.react;
    if (r && now >= r.start && now < r.end) {
      const f = (now - r.start) / (r.end - r.start);
      if (r.kind === "knock") {
        const k = jolt(f) * r.amp;
        p.dx += r.dir.x * 0.16 * k;
        p.dz += r.dir.z * 0.16 * k;
        p.sy *= 1 - 0.14 * k;
        p.sx *= 1 + 0.08 * k;
        p.sz *= 1 + 0.08 * k;
        // Rock back, away from the blow, whichever way the unit faces.
        const away = Math.atan2(r.dir.x, r.dir.z) - u.facing;
        p.pitch -= Math.cos(away) * 0.35 * k;
        p.roll += Math.sin(away) * 0.35 * k;
      } else if (r.kind === "dodge") {
        // Sidestep out of the way and back.
        const side = u.phase > Math.PI ? 1 : -1;
        const k = Math.sin(Math.PI * f) * 0.32 * r.amp * side;
        p.dx += -r.dir.z * k;
        p.dz += r.dir.x * k;
        p.roll += 0.25 * k;
      } else {
        const k = jolt(f) * 0.08 * r.amp;
        p.dx += r.dir.x * k;
        p.dz += r.dir.z * k;
      }
    }
    return p;
  }

  /** Keep each unit's status auras in step with its statuses, and animate them. */
  private updateAuras(u: UnitView, v: ViewUnit, t: number): void {
    const want = v.alive && !u.ko ? v.statuses : new Map<string, string>();
    for (const [id, aura] of u.auras) {
      if (want.has(id)) continue;
      for (const b of aura.bits) {
        u.root.remove(b);
        b.geometry.dispose();
        (b.material as THREE.Material).dispose();
      }
      u.auras.delete(id);
    }
    for (const id of want.keys()) {
      if (u.auras.has(id) || !AURAS[id]) continue;
      const def = AURAS[id]!;
      const bits: THREE.Mesh[] = [];
      for (let i = 0; i < def.n; i++) {
        const geo =
          def.kind === "ring"
            ? new THREE.RingGeometry(0.4, 0.44, 20).rotateX(-Math.PI / 2)
            : def.kind === "orbit"
              ? new THREE.OctahedronGeometry(0.045, 0)
              : new THREE.TetrahedronGeometry(0.035, 0);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: def.color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        u.root.add(m);
        bits.push(m);
      }
      u.auras.set(id, { kind: def.kind, bits });
    }
    for (const aura of u.auras.values()) {
      aura.bits.forEach((m, i) => {
        const ph = i / aura.bits.length;
        const mat = m.material as THREE.MeshBasicMaterial;
        switch (aura.kind) {
          case "orbit": {
            const ang = t * 4 + ph * Math.PI * 2;
            m.position.set(Math.cos(ang) * 0.22, 1.08 + Math.sin(t * 6 + i) * 0.03, Math.sin(ang) * 0.22);
            m.rotation.y = t * 5;
            mat.opacity = 0.95;
            break;
          }
          case "rise": {
            const k = (t * 0.9 + ph) % 1;
            const ang = ph * Math.PI * 2 + t;
            m.position.set(Math.cos(ang) * 0.2, 0.2 + k * 0.9, Math.sin(ang) * 0.2);
            mat.opacity = 1 - k;
            break;
          }
          case "fall": {
            const k = (t * 1.2 + ph) % 1;
            const ang = ph * Math.PI * 2;
            m.position.set(Math.cos(ang) * 0.16, 0.85 - k * 0.8, Math.sin(ang) * 0.16);
            mat.opacity = 1 - k * 0.7;
            break;
          }
          case "ring":
            m.position.y = 0.03;
            m.rotation.y = t;
            m.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
            mat.opacity = 0.45 + Math.sin(t * 3) * 0.2;
            break;
        }
      });
    }
  }

  render(now: number, view: ViewState): void {
    if (!this.ok) return;
    this.controls.update();
    const t = now / 1000;
    for (const [uid, u] of this.units) {
      const v = view.units.get(uid);
      if (!v) continue;
      const base = this.unitWorld(v);
      let { x, y, z } = base;
      let squash = 1;
      // Hop between tiles.
      if (now < v.moveEnd && v.moveEnd > v.moveStart) {
        const f = (now - v.moveStart) / (v.moveEnd - v.moveStart);
        y += Math.sin(Math.PI * f) * 0.22;
        squash = 1 + Math.sin(Math.PI * f) * 0.12;
        const dx = this.world(v.x, v.y).x - u.root.position.x;
        const dz = this.world(v.x, v.y).z - u.root.position.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.001) u.yaw = Math.atan2(dx, dz);
      }
      // Attack and reaction deforms: offsets here, then lean / twist / stretch below.
      const p = this.pose(u, now);
      x += p.dx;
      y += p.dy;
      z += p.dz;
      const flyer = FLYERS.has(v.raceId);
      if (flyer && !u.ko) {
        // Flyers hover over the ground (or the pit) with a lazy bob; wings flap.
        y += 0.38 + Math.sin(t * 3 + u.phase) * 0.06;
        const flap = Math.sin(t * (now < v.moveEnd ? 18 : 7) + u.phase) * 0.55;
        u.model.traverse((o) => {
          if (o.userData.wing) o.rotation.y = -0.25 + flap * 0.6;
        });
      }
      u.root.position.set(x, y, z);
      u.shadow.visible = flyer && !u.ko;
      u.shadow.position.y = base.y - y + 0.02;
      u.ring.position.y = base.y - y + 0.01;
      // Idle bob and sway (calmer when it's not your turn).
      const active = view.current === uid;
      const bob = Math.sin(t * (active ? 7 : 3.2) + u.phase);
      u.model.position.y = Math.max(0, bob) * (active ? 0.05 : 0.025);
      const sq = 1 / Math.sqrt(squash);
      u.model.scale.set(UNIT_SCALE * sq * p.sx, UNIT_SCALE * squash * p.sy, UNIT_SCALE * sq * p.sz);
      u.model.rotation.z = Math.sin(t * 1.7 + u.phase) * 0.04 + p.roll;
      // Turn smoothly toward the current facing; attacks twist on top.
      let d = u.yaw - u.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      u.facing += d * 0.25;
      u.model.rotation.y = u.facing + p.twist;
      if (!u.ko) u.model.rotation.x = p.pitch;
      // Hit flash, or a caster's glow while it works.
      const flashing = u.flash && now >= u.flash.start && now < u.flash.end;
      for (const m of u.materials) {
        if (flashing) {
          const f = 1 - (now - u.flash!.start) / (u.flash!.end - u.flash!.start);
          m.emissive.copy(u.flash!.color).multiplyScalar(f * 0.9);
        } else if (p.glow > 0 && u.action) {
          m.emissive.copy(u.action.color).multiplyScalar(p.glow * 0.6);
        } else {
          m.emissive.copy(m.userData.baseEmissive as THREE.Color);
        }
      }
      this.updateAuras(u, v, t);
      // Knockout: topple and sink away.
      if (u.ko) {
        const f = Math.min(1, (now - u.ko.start) / 700);
        u.model.rotation.x = -f * Math.PI * 0.5;
        u.root.position.y = y - Math.max(0, f - 0.5) * 0.8;
        u.ring.visible = false;
        u.hpBack.visible = u.hpFill.visible = false;
        if (f >= 1) u.root.visible = false;
      }
      // Ring: highlight whoever is acting.
      const ringMat = u.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = active ? 0.6 + Math.sin(t * 8) * 0.35 : 0.55;
      u.ring.scale.setScalar(active ? 1.15 : 1);
      // HP bar, billboarded.
      const frac = Math.max(0, v.hp / Math.max(1, v.maxHp));
      for (const bar of [u.hpBack, u.hpFill]) {
        bar.position.set(0, 1.25, 0);
        bar.quaternion.copy(this.camera.quaternion);
      }
      u.hpFill.scale.x = Math.max(0.001, frac);
      u.hpFill.translateX(-0.3 * (1 - frac));
      (u.hpFill.material as THREE.MeshBasicMaterial).color.setHex(frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xe0b04a : 0xe05d52);
    }
    this.fx = this.fx.filter((f) => {
      f.update(now);
      if (now > f.until) {
        f.dispose();
        return false;
      }
      return true;
    });
    // Camera shake: a brief, decaying jitter around the orbit position.
    const off = new THREE.Vector3();
    if (this.shake && now >= this.shake.start && now < this.shake.end) {
      const f = 1 - (now - this.shake.start) / (this.shake.end - this.shake.start);
      const a = this.shake.amp * f;
      off.set(Math.sin(now * 0.09) * a, Math.sin(now * 0.073 + 1) * a * 0.6, Math.cos(now * 0.081) * a);
      this.camera.position.add(off);
    }
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(off);
    this.drawOverlay(now, view);
  }

  /** Screen position (CSS px within the host) of a point above a unit. */
  private screenOf(uid: number, lift: number): { x: number; y: number } | null {
    const u = this.units.get(uid);
    if (!u || !u.root.visible) return null;
    this.tmp.copy(u.root.position).setY(u.root.position.y + lift).project(this.camera);
    const el = this.renderer.domElement;
    return { x: ((this.tmp.x + 1) / 2) * el.clientWidth, y: ((1 - this.tmp.y) / 2) * el.clientHeight };
  }

  /** Crisp HTML text over the 3D view: floaters, speech bubbles, status tags. */
  private drawOverlay(now: number, view: ViewState): void {
    const seen = new Set<string>();
    const place = (key: string, cls: string, text: string, x: number, y: number, style: Partial<CSSStyleDeclaration> = {}) => {
      seen.add(key);
      let el = this.labelCache.get(key);
      if (!el) {
        el = document.createElement("div");
        this.overlay.append(el);
        this.labelCache.set(key, el);
      }
      el.className = cls;
      if (el.textContent !== text) el.textContent = text;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      Object.assign(el.style, style);
    };
    for (const [uid, v] of view.units) {
      if (!v.alive || v.statuses.size === 0) continue;
      const p = this.screenOf(uid, 1.4);
      if (p) place(`st${uid}`, "tag3d", [...v.statuses.values()].join(" "), p.x, p.y);
    }
    view.floaters.forEach((f, i) => {
      const p = this.screenOf(f.uid, 0.9);
      if (!p) return;
      const k = (now - f.start) / (f.until - f.start);
      place(`f${f.start}-${f.uid}-${i}`, "float3d", f.text, p.x, p.y - k * 28, { color: f.color, opacity: String(1 - k * 0.7) });
    });
    for (const b of view.bubbles) {
      const p = this.screenOf(b.uid, 1.7);
      if (!p) continue;
      const side = view.units.get(b.uid)?.side;
      place(`b${b.uid}`, `bubble3d ${side ?? ""}`, b.text, p.x, p.y);
    }
    for (const [key, el] of this.labelCache) {
      if (!seen.has(key)) {
        el.remove();
        this.labelCache.delete(key);
      }
    }
  }

  dispose(): void {
    this.resize.disconnect();
    if (!this.ok) return;
    this.controls.dispose();
    for (const f of this.fx) f.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
    this.host.replaceChildren();
  }
}
