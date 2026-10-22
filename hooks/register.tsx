import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FeedItem, Kind, LastTurn, Plan, Step, StepStatus } from '../types'

// Galaxie : une planète sur toute la hauteur du panneau, où chaque action de Claude est une comète
// en orbite avec son nom ; en bas, sans fond, la demande, la progression et ce qui se passe.
// Rendu en quarts de bloc (2×2 pixels par case) dans un Raster repeint par $.ui.blit.

const PANE = 'galaxie'
const KEY = 'vue'
const TICK_MS = 66
const TOOL = 'mcp__galaxie__etapes'
const FINALE_MS = 2200
// lu par la mini-planète flottante : ~/.claude/galaxie-etat.json de celui qui a installé le mod
let etatFile = ''

const feedAtom = atom({ plugin: 'galaxie', key: 'feed' } as const, [] as FeedItem[])
const lastTurnAtom = atom({ plugin: 'galaxie', key: 'lastTurn' } as const, { from: 0, ms: 0 } as LastTurn)
const planAtom = atom({ plugin: 'galaxie', key: 'plan' } as const, { demande: '', etapes: [], maj: 0 } as Plan)

type RGB = [number, number, number]
const rgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255]
const pack = (c: RGB) => (clamp(Math.round(c[0]), 0, 255) << 16) | (clamp(Math.round(c[1]), 0, 255) << 8) | clamp(Math.round(c[2]), 0, 255)
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k]
const lerp = (a: number, b: number, k: number) => pack(mix(rgb(a), rgb(b), k))
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

// couleurs lisibles sur fond clair comme sombre ; DEF = celle du terminal
const DEF = 0x01000000
const C = {
  lecture: 0x4a9dff, commande: 0xf28a2e, web: 0x2fc46f, ecriture: 0xe8b520, runway: 0x9a6bff, autre: 0x8d9ab0,
  succes: 0x22a55a, erreur: 0xe0344a, parole: 0xf0a030, pensee: 0xc061ff, veille: 0x8a8fa3,
  gris: 0x8a8fa3, rail: 0xb9bdcc, titre: 0x6d5cff, blanc: 0xf2f4ff, or: 0xffd76a,
}
const SPACE = rgb(0x080a16)
const KIND_COLOR: Record<Kind, number> = {
  lecture: C.lecture, commande: C.commande, web: C.web, ecriture: C.ecriture, runway: C.runway, autre: C.autre,
}

type Comet = { angle: number; orbit: number; speed: number; color: number; label: string; start: number; fade: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number }
type Ring = { x: number; y: number; r: number; max: number; color: number }
type Shooting = { x: number; y: number; vx: number; vy: number; life: number }

// --- état (l'animation repart à zéro à un rechargement ; le fil et le plan sont dans $.state) ---
let cols = 0
let rows = 0
let heroRows = 10
let mounted = false
let t = 0
let energy = 0
let lastText = 0
let lastThink = 0
let turnStart = 0
let finaleAt = 0
let lastTurn: LastTurn = { from: 0, ms: 0 }
let plan: Plan = { demande: '', etapes: [], maj: 0 }
const running = new Map<string, { label: string; kind: Kind; start: number }>()
const comets = new Map<string, Comet>()
const generations = new Map<string, Comet>()
let sparks: Spark[] = []
let rings: Ring[] = []
let shooting: Shooting[] = []
let stars: { x: number; y: number; b: number; tw: number; ph: number }[] = []
let feed: FeedItem[] = []
let spinnerLabel: string | null = null

const now = () => Date.now()
const rand = (a: number, b: number) => a + Math.random() * (b - a)
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)) }
const base = (p: unknown) => {
  const s = typeof p === 'string' ? p : ''
  return s.split('/').filter(Boolean).pop() ?? s
}
const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s)
const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function classify(tool: string, input: Record<string, unknown>): { kind: Kind; label: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Read': return { kind: 'lecture', label: `lit ${base(input.file_path)}` }
    case 'Glob':
    case 'Grep': return { kind: 'lecture', label: 'cherche dans les fichiers' }
    case 'Write': return { kind: 'ecriture', label: `écrit ${base(input.file_path)}` }
    case 'Edit':
    case 'NotebookEdit': return { kind: 'ecriture', label: `modifie ${base(input.file_path ?? input.notebook_path)}` }
    case 'Bash': return { kind: 'commande', label: (str('description') || `commande ${cut(str('command'), 30)}`).replace(/^./, c => c.toLowerCase()) }
    case 'WebSearch': return { kind: 'web', label: `cherche : ${str('query')}` }
    case 'WebFetch': return { kind: 'web', label: 'lit une page web' }
    case 'Agent': return { kind: 'autre', label: 'lance un sous-agent' }
    case 'Skill': return { kind: 'autre', label: `skill ${str('skill')}` }
    case 'ToolSearch': return { kind: 'autre', label: 'charge des outils' }
    case 'AskUserQuestion': return { kind: 'autre', label: 'te pose une question' }
    case 'Artifact': return { kind: 'ecriture', label: 'publie une page' }
  }
  if (tool.startsWith('mcp__runway__')) {
    const what = tool.slice('mcp__runway__'.length)
    if (what === 'generate_image') return { kind: 'runway', label: 'génère une image' }
    if (what.startsWith('generate_')) return { kind: 'runway', label: 'génère une vidéo' }
    if (what === 'get_task') return { kind: 'runway', label: 'vérifie une génération' }
    return { kind: 'runway', label: `Runway : ${what}` }
  }
  if (tool.startsWith('mcp__')) return { kind: 'web', label: `outil ${tool.split('__')[1] ?? tool}` }
  return { kind: 'autre', label: tool }
}

function state(): { text: string; color: number; busy: boolean } {
  const last = [...running.values()].pop()
  if (last) return { text: last.label, color: KIND_COLOR[last.kind], busy: true }
  const ms = now()
  if (ms - finaleAt < FINALE_MS) return { text: "c'est fini !", color: C.succes, busy: false }
  if (ms - lastText < 1500) return { text: "j'écris ma réponse", color: C.parole, busy: true }
  if (ms - lastThink < 2000) return { text: 'je réfléchis', color: C.pensee, busy: true }
  if (turnStart) return { text: 'je prépare la suite', color: C.titre, busy: true }
  return { text: "en veille, j'attends ton message", color: C.veille, busy: false }
}

// --- la scène : W×H pixels, un pixel = un quart de case (deux fois plus haut que large) ---
let W = 0, H = 0
let R = new Float32Array(0), G = new Float32Array(0), B = new Float32Array(0)

// unités « verticales » : 1 = un pixel de haut = deux pixels de large
function planet() {
  const r = Math.max(4, Math.min(H * 0.24, (W / 2) * 0.17))
  return { x: W * 0.46, y: H * 0.5, r }
}
const orbitPos = (c: Comet, angle = c.angle) => {
  const p = planet()
  return { x: p.x + Math.cos(angle) * c.orbit * 2, y: p.y + Math.sin(angle) * c.orbit * 0.42 }
}

function add(x: number, y: number, c: number | RGB, k: number) {
  const xi = Math.round(x), yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= W || yi >= H || k <= 0) return
  const v = typeof c === 'number' ? rgb(c) : c
  const i = yi * W + xi
  R[i] = R[i]! + v[0] * k; G[i] = G[i]! + v[1] * k; B[i] = B[i]! + v[2] * k
}
function set(x: number, y: number, v: RGB) {
  const xi = Math.round(x), yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return
  const i = yi * W + xi
  R[i] = v[0]; G[i] = v[1]; B[i] = v[2]
}
// un point « gras » (2 pixels de large, comme un carré à l'écran)
const dot = (x: number, y: number, c: number | RGB, k: number) => { add(x, y, c, k); add(x + 1, y, c, k) }

const hash = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s) }
function noise(x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function drawScene(accent: number) {
  W = cols * 2; H = heroRows * 2
  if (R.length !== W * H) { R = new Float32Array(W * H); G = new Float32Array(W * H); B = new Float32Array(W * H) }
  R.fill(SPACE[0]); G.fill(SPACE[1]); B.fill(SPACE[2])
  const finale = clamp(1 - (now() - finaleAt) / FINALE_MS, 0, 1)
  const col = mix(rgb(accent), rgb(C.succes), finale * 0.8)

  // étoiles : peu, deux éclats
  const want = Math.floor((W * H) / 140)
  if (stars.length !== want) stars = Array.from({ length: want }, () => ({ x: Math.random(), y: Math.random(), b: rand(0.25, 0.8), tw: rand(0.5, 3), ph: rand(0, 6.28) }))
  for (const s of stars) {
    s.x -= 0.0001 * s.b
    if (s.x < 0) s.x += 1
    const on = Math.sin(t * 0.05 * s.tw + s.ph) > -0.2
    add(s.x * W, s.y * H, C.blanc, on ? s.b * 0.75 : s.b * 0.3)
  }
  // étoiles filantes
  if (Math.random() < 0.012) shooting.push({ x: rand(W * 0.3, W), y: rand(0, H * 0.4), vx: -rand(4, 7), vy: rand(1, 2), life: 18 })
  for (const s of shooting) {
    for (let j = 0; j < 8; j++) add(s.x - s.vx * j * 0.5, s.y - s.vy * j * 0.5, C.blanc, (1 - j / 8) * 0.8 * (s.life / 18))
  }

  const p = planet()
  // palette de la planète : cinq teintes franches, de l'ombre à la lumière
  const shades: RGB[] = [scale(col, 0.18), scale(col, 0.38), scale(col, 0.62), col, mix(col, rgb(C.blanc), 0.4)]
  const ringIn = p.r * 1.4, ringOut = p.r * 1.95
  const drawRing = (front: boolean) => {
    for (let y = Math.floor(p.y - ringOut * 0.34) - 1; y <= p.y + ringOut * 0.34 + 1; y++)
      for (let x = Math.floor(p.x - ringOut * 2); x <= p.x + ringOut * 2; x++) {
        const dx = (x - p.x) / 2, dy = (y - p.y) / 0.32
        const d = Math.hypot(dx, dy)
        if (d < ringIn || d > ringOut || (dy > 0) !== front) continue
        const band = Math.sin(d * 1.7 - t * 0.04) > 0 ? 3 : 2
        set(x, y, mix(shades[band]!, rgb(C.blanc), 0.15))
      }
  }
  drawRing(false)
  const rot = t * (0.01 + Math.min(energy, 8) * 0.006)
  for (let y = Math.floor(p.y - p.r); y <= p.y + p.r; y++)
    for (let x = Math.floor(p.x - p.r * 2); x <= p.x + p.r * 2; x++) {
      const nx = (x - p.x) / (p.r * 2), ny = (y - p.y) / p.r
      const rr = nx * nx + ny * ny
      if (rr > 1) continue
      const nz = Math.sqrt(1 - rr)
      const light = clamp(-0.5 * nx - 0.65 * ny + 0.6 * nz, 0, 1)
      const u = Math.atan2(nx, nz) + rot
      const band = Math.sin(ny * 6 + noise(u * 1.2, ny * 2.5) * 2.5) * 0.18
      const lvl = clamp(Math.floor((light + band) * 4.6), 0, 4)
      set(x, y, shades[lvl]!)
    }
  drawRing(true)

  // générations Runway : lunes qui grossissent
  for (const g of generations.values()) {
    g.angle += g.speed
    const pos = orbitPos(g)
    const size = clamp(1 + (now() - g.start) / 20000, 1, 3)
    for (let y = -Math.ceil(size); y <= size; y++)
      for (let x = -Math.ceil(size * 2); x <= size * 2; x++)
        if ((x / 2) ** 2 + y * y <= size * size) set(pos.x + x, pos.y + y, x + y < 0 ? mix(rgb(g.color), rgb(C.blanc), 0.35) : rgb(g.color))
  }

  // comètes : une par action, traînée le long de l'orbite en quatre paliers
  for (const c of comets.values()) {
    c.angle += c.speed
    for (let j = 22; j >= 1; j--) {
      const q = orbitPos(c, c.angle - c.speed * j * 1.3)
      add(q.x, q.y, c.color, c.fade * Math.ceil((1 - j / 23) * 4) / 4 * 0.9)
    }
    const head = orbitPos(c)
    dot(head.x - 1, head.y, c.color, c.fade)
    dot(head.x, head.y, C.blanc, c.fade)
  }

  for (const r of rings) {
    const steps = Math.ceil(r.r * 10) + 12
    const k = Math.ceil((1 - r.r / r.max) * 3) / 3
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      dot(r.x + Math.cos(a) * r.r * 2, r.y + Math.sin(a) * r.r * 0.75, r.color, k)
    }
  }
  for (const s of sparks) dot(s.x, s.y, s.color, Math.ceil((s.life / s.max) * 3) / 3)
}

function step() {
  t++
  energy *= 0.95
  for (const s of sparks) { s.x += s.vx; s.y += s.vy; s.vy += 0.05; s.vx *= 0.98; s.life-- }
  sparks = sparks.filter(s => s.life > 0)
  for (const r of rings) r.r += 0.9
  rings = rings.filter(r => r.r < r.max)
  for (const s of shooting) { s.x += s.vx; s.y += s.vy; s.life-- }
  shooting = shooting.filter(s => s.life > 0)
  for (const [id, c] of comets) {
    if (running.has(id) || id === '__etat') c.fade = Math.min(1, c.fade + 0.08)
    else { c.fade -= 0.06; if (c.fade <= 0) comets.delete(id) }
  }
  const st = state()
  if (running.size === 0 && st.busy) {
    const c = comets.get('__etat')
    if (c) { c.label = st.text; c.color = st.color }
    else if (W > 0) comets.set('__etat', newComet(st.text, st.color, now()))
  } else if (comets.has('__etat')) {
    const c = comets.get('__etat')!
    c.fade -= 0.1
    if (c.fade <= 0) comets.delete('__etat')
  }
}

function newComet(label: string, color: number, start: number): Comet {
  const p = planet()
  const taken = [...comets.values()].map(c => c.orbit)
  let orbit = p.r * 2.3
  while (taken.some(o => Math.abs(o - orbit) < 3) && orbit < p.r * 4) orbit += 3.5
  orbit = Math.min(orbit, (p.x - 4) / 2, (W - p.x - 4) / 2)
  return { angle: rand(0, 6.28), orbit, speed: 0.03 + rand(0, 0.012), color, label, start, fade: 0 }
}

function burst(x: number, y: number, color: number | number[], n: number, power = 1) {
  const colors = Array.isArray(color) ? color : [color]
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(0.4, 1.3) * power
    sparks.push({ x, y, vx: Math.cos(a) * v * 2, vy: Math.sin(a) * v - 0.4 * power, life: 22, max: 22, color: colors[i % colors.length]! })
  }
}

// le feu d'artifice de fin de réponse
function finale() {
  finaleAt = now()
  if (W <= 0) return
  const p = planet()
  rings.push({ x: p.x, y: p.y, r: p.r, max: p.r * 4, color: C.succes })
  rings.push({ x: p.x, y: p.y, r: p.r * 0.6, max: p.r * 3, color: C.or })
  burst(p.x, p.y - p.r, [C.or, C.succes, C.blanc, C.pensee, C.lecture], 60, 1.6)
  energy += 3
}

// --- composition : chaque case = 2×2 pixels, rendus en quart de bloc avec deux couleurs ---
const QUAD = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
const SPIN = ['◐', '◓', '◑', '◒']
const qz = (v: RGB): RGB => [Math.round(v[0] / 24) * 24, Math.round(v[1] / 24) * 24, Math.round(v[2] / 24) * 24]

function frame(): string {
  if (cols <= 0 || rows <= 0) return ''
  const st = state()
  const live = turnStart > 0
  const steps = plan.etapes
  const done = steps.filter(s => s.statut === 'fait').length
  const allDone = steps.length > 0 && done === steps.length
  const stepLines = !steps.length ? 0 : allDone ? 1 : Math.min(3, steps.length)
  const infoRows = 1 + 2 + stepLines + 1
  heroRows = Math.max(6, rows - infoRows)
  drawScene(st.busy ? st.color : C.titre)

  const words = new Uint32Array(cols * rows * 3)
  for (let i = 0; i < cols * rows; i++) { words[i * 3] = 32; words[i * 3 + 1] = DEF; words[i * 3 + 2] = DEF }
  const put = (r: number, c: number, ch: number, fg: number, bg: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return
    const i = (r * cols + c) * 3
    words[i] = ch; words[i + 1] = fg; words[i + 2] = bg
  }
  const px = (x: number, y: number): RGB => {
    const i = clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)
    return qz([R[i]!, G[i]!, B[i]!])
  }
  for (let r = 0; r < heroRows; r++)
    for (let c = 0; c < cols; c++) {
      const q = [px(c * 2, r * 2), px(c * 2 + 1, r * 2), px(c * 2, r * 2 + 1), px(c * 2 + 1, r * 2 + 1)]
      // les deux teintes les plus éloignées de la case, chaque pixel prend la plus proche
      let a = 0, b = 0, best = -1
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const d = dist(q[i]!, q[j]!); if (d > best) { best = d; a = i; b = j } }
      if (best < 30) { put(r, c, 0x2588, pack(q[0]!), pack(q[0]!)); continue }
      let mask = 0
      const fg: RGB[] = [], bg: RGB[] = []
      q.forEach((v, i) => { if (dist(v, q[a]!) <= dist(v, q[b]!)) { mask |= 1 << i; fg.push(v) } else bg.push(v) })
      const avg = (l: RGB[]): RGB => l.reduce<RGB>((s, v) => [s[0] + v[0] / l.length, s[1] + v[1] / l.length, s[2] + v[2] / l.length], [0, 0, 0])
      put(r, c, QUAD[mask]!, pack(avg(fg)), pack(bg.length ? avg(bg) : avg(fg)))
    }

  const cellBg = (r: number, c: number): number => {
    const v = [px(c * 2, r * 2), px(c * 2 + 1, r * 2), px(c * 2, r * 2 + 1), px(c * 2 + 1, r * 2 + 1)]
    return pack(mix(v.reduce<RGB>((s, x) => [s[0] + x[0] / 4, s[1] + x[1] / 4, s[2] + x[2] / 4], [0, 0, 0]), SPACE, 0.6))
  }
  const over = (r: number, c: number, s: string, fg: number) => {
    let x = c
    for (const ch of s) {
      if (x >= cols) break
      if (x >= 0 && r >= 0 && r < heroRows) put(r, x, ch.codePointAt(0) ?? 32, fg, cellBg(r, x))
      x++
    }
  }
  const text = (r: number, c: number, s: string, fg: number) => {
    let x = c
    for (const ch of s) {
      if (x >= cols) break
      const cp = ch.codePointAt(0) ?? 32
      if (x >= 0) put(r, x, cp > 0xffff || cp < 32 ? 0x3f : cp, fg, DEF)
      x++
    }
  }
  const right = (r: number, s: string, fg: number) => text(r, cols - 1 - s.length, s, fg)

  over(0, 1, '✦ GALAXIE', C.pensee)
  const clock = live ? fmt(now() - turnStart) : lastTurn.ms ? fmt(lastTurn.ms) : ''
  if (clock) over(0, cols - clock.length - 2, clock, C.gris)
  for (const [id, cm] of comets) {
    if (cm.fade < 0.3) continue
    const head = orbitPos(cm)
    const row = Math.floor(head.y / 2), hc = Math.floor(head.x / 2)
    if (row < 1 || row >= heroRows) continue
    const run = running.get(id)
    const label = `${cm.label}${run ? ' ' + fmt(now() - run.start) : ''}`
    const goLeft = hc > cols * 0.62
    const s = cut(label, goLeft ? hc - 3 : cols - hc - 3)
    over(row, goLeft ? hc - 2 - s.length : hc + 2, s, lerp(cm.color, C.blanc, 0.4))
  }
  if (now() - finaleAt < FINALE_MS) {
    const p = planet()
    const msg = '✓ réponse terminée'
    over(Math.min(heroRows - 1, Math.floor((p.y + p.r) / 2) + 2), Math.floor(p.x / 2 - msg.length / 2), msg, C.succes)
  }

  // ---- infos compactes en bas, sans fond ----
  const inner = cols - 2
  let r = heroRows + 1
  const tag = steps.length ? `${done}/${steps.length}` : live ? 'en cours' : lastTurn.ms ? `fini en ${fmt(lastTurn.ms)}` : ''
  text(r, 1, cut(plan.demande ? `« ${plan.demande} »` : '—', inner - tag.length - 2), DEF)
  right(r, tag, allDone ? C.succes : live ? C.titre : C.gris)
  r++
  const ratio = steps.length ? done / steps.length : 0
  const fill = Math.round(inner * ratio)
  for (let i = 0; i < inner; i++) {
    let fg = i < fill ? (ratio === 1 ? C.succes : C.titre) : C.rail
    if (live) {
      const span = steps.length ? Math.max(fill, 1) : inner
      const wave = (t * 0.8) % (span + 14) - 7
      const k = Math.exp(-(((i - wave) / 3) ** 2))
      if (i < fill) fg = lerp(fg, C.blanc, k * 0.55)
      else if (!steps.length) fg = lerp(C.rail, C.titre, k)
    }
    text(r, 1 + i, '━', fg)
  }
  r++
  if (allDone) {
    text(r++, 1, `✓ ${steps.length} étape${steps.length > 1 ? 's' : ''} faite${steps.length > 1 ? 's' : ''}`, C.succes)
  } else if (steps.length) {
    const cur = Math.max(0, steps.findIndex(s => s.statut !== 'fait'))
    for (const s of steps.slice(Math.max(0, cur - 1), Math.max(0, cur - 1) + 3)) {
      if (s.statut === 'fait') { text(r, 1, '✓', C.succes); text(r, 3, cut(s.titre, inner - 3), C.gris) }
      else if (s.statut === 'en_cours') {
        text(r, 1, SPIN[Math.floor(t / 3) % 4]!, C.titre)
        text(r, 3, cut(s.titre, inner - 10), C.titre)
        if (s.depuis) right(r, fmt(now() - s.depuis), C.titre)
      } else { text(r, 1, '○', C.rail); text(r, 3, cut(s.titre, inner - 3), C.gris) }
      r++
    }
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.25)
  const lit = st.busy || st.color === C.succes
  text(r, 1, '●', lit ? lerp(st.color, C.blanc, pulse * 0.45) : C.veille)
  text(r, 3, cut(st.text + (st.busy ? '…' : ''), inner - 3), lit ? st.color : C.gris)

  return toBase64(new Uint8Array(words.buffer))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64(u: Uint8Array): string {
  const native = (u as unknown as { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(u)
  let out = ''
  let i = 0
  const ch = (n: number) => B64.charAt(n & 63)
  for (; i + 2 < u.length; i += 3) {
    const n = (u[i]! << 16) | (u[i + 1]! << 8) | u[i + 2]!
    out += ch(n >> 18) + ch(n >> 12) + ch(n >> 6) + ch(n)
  }
  if (i < u.length) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8)
    out += ch(n >> 18) + ch(n >> 12) + (i + 1 < u.length ? ch(n >> 6) : '=') + '='
  }
  return out
}

const save = ($: EngineInterface) => {
  void update($, feedAtom, () => feed.slice(-60)).catch(() => {})
  void update($, lastTurnAtom, () => lastTurn).catch(() => {})
  void update($, planAtom, () => plan).catch(() => {})
}

async function restore($: EngineInterface) {
  feed = [...(await read($, feedAtom))].map(f => (f.end === undefined ? { ...f, end: f.start, ok: true } : f))
  lastTurn = await read($, lastTurnAtom)
  plan = await read($, planAtom)
}

const STATUTS: StepStatus[] = ['fait', 'en_cours', 'a_faire']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'galaxie', description: 'Ouvre la Galaxie : où en est Claude, en direct' })
    await $.tool.register({
      name: 'etapes',
      description:
        "Affiche dans le panneau Galaxie de l'utilisateur où tu en es de sa demande. Appelle-le au début de toute tâche " +
        "en plusieurs étapes (avec `demande` résumée en une phrase et la liste complète des étapes), puis à chaque " +
        "changement d'étape, en renvoyant toute la liste avec les statuts à jour. Étapes courtes, en français, à " +
        "l'infinitif (« Lire le devis »). Une seule étape en_cours à la fois.",
      inputSchema: {
        type: 'object',
        properties: {
          demande: { type: 'string', description: 'La demande de l’utilisateur, résumée en une phrase courte' },
          etapes: {
            type: 'array',
            items: {
              type: 'object',
              properties: { titre: { type: 'string' }, statut: { type: 'string', enum: STATUTS } },
              required: ['titre', 'statut'],
            },
          },
        },
        required: ['etapes'],
      },
    })
    await restore($).catch(() => {})
    void $.ui.open({ id: PANE, title: 'Galaxie' })
    // l'état pour la mini-planète : écrit quand il change, et toutes les 5 s pour dire « je suis là »
    const home = await $.env.get('HOME').catch(() => undefined)
    if (home) etatFile = `${home}/.claude/galaxie-etat.json`
    let sig = ''
    let wrote = 0
    $.clock.every(250, async () => {
      if (!etatFile) return
      const st = state()
      const etat = running.size || turnStart ? 'travail' : finaleAt ? 'pret' : 'veille'
      const couleur = '#' + (etat === 'pret' ? C.succes : st.color).toString(16).padStart(6, '0')
      const n = running.size || (etat === 'travail' ? 1 : 0)
      const s = `${etat}|${couleur}|${n}|${finaleAt}`
      if (s === sig && now() - wrote < 5000) return
      sig = s
      wrote = now()
      await $.fs.write(etatFile,JSON.stringify({ etat, couleur, n, fin: finaleAt, t: now() })).catch(() => {})
    })
    $.clock.every(TICK_MS, async () => {
      if (!mounted || cols <= 0) return
      step()
      const res = await $.ui.blit({ requestId: PANE, key: KEY, cells: frame(), columns: cols, rows })
      if ('deny' in res && res.deny) mounted = false
    })
    return next(e)
  })

  on('command.run', { command: 'galaxie' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Galaxie' })
    return { text: 'Galaxie ouverte.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { demande?: unknown; etapes?: unknown }
    const raw = Array.isArray(input.etapes) ? input.etapes : []
    const prev = new Map(plan.etapes.map(s => [s.titre, s]))
    const etapes: Step[] = raw.flatMap(x => {
      const o = x as { titre?: unknown; statut?: unknown }
      if (typeof o.titre !== 'string') return []
      const statut = STATUTS.includes(o.statut as StepStatus) ? (o.statut as StepStatus) : 'a_faire'
      const old = prev.get(o.titre)
      const depuis = statut === 'en_cours' ? (old?.statut === 'en_cours' && old.depuis ? old.depuis : now()) : undefined
      return [{ titre: o.titre, statut, ...(depuis ? { depuis } : {}) }]
    })
    const newlyDone = etapes.filter(s => s.statut === 'fait' && prev.get(s.titre)?.statut !== 'fait').length
    plan = { demande: typeof input.demande === 'string' && input.demande ? input.demande : plan.demande, etapes, maj: now() }
    if (newlyDone && W > 0) { const p = planet(); rings.push({ x: p.x, y: p.y, r: p.r, max: p.r * 2.6, color: C.succes }); energy += 2 }
    save($)
    const done = etapes.filter(s => s.statut === 'fait').length
    return { result: `Panneau à jour : ${done}/${etapes.length} étapes faites.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>La Galaxie s'affiche dans le terminal.</Text>
    }
    const { Raster } = $.ui.resolve(e)
    cols = clamp(e.props.bodyColumns, 24, 512)
    rows = clamp(e.props.scroll?.bodyRows || (e.viewport?.rows ?? 30) - 3, 14, 256)
    mounted = true
    step()
    return <Raster key={KEY} columns={cols} rows={rows} cells={frame()} />
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) =>
    spinnerLabel ? next({ ...e, props: { ...e.props, message: spinnerLabel } }) : next(e),
  )

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      turnStart = now()
      energy += 1
      if (e.text.trim()) plan = { demande: cut(e.text.trim(), 160), etapes: [], maj: now() }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && turnStart) {
      const ms = now() - turnStart
      if (ms > 45_000) $.ui.toast(`✓ Claude a fini (${fmt(ms)})`)
      if (ms > 90_000) void $.ui.notify(`Terminé en ${fmt(ms)}`, { title: 'Claude' })
      lastTurn = { from: turnStart, ms }
      turnStart = 0
      spinnerLabel = null
      finale()
      save($)
    }
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    while (true) {
      const r = await stream.next()
      if (r.done) return r.value
      const c = r.value
      if (c.kind === 'text') { lastText = now(); energy = Math.min(8, energy + 0.1) }
      else if (c.kind === 'thinking') { lastThink = now(); energy = Math.min(8, energy + 0.05) }
      yield c
    }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === TOOL) return next(e)
    const id = e.tool_use_id
    const input = e as unknown as Record<string, unknown>
    const { kind, label } = classify(tool, input)
    const start = now()
    try {
      running.set(id, { label, kind, start })
      if (W > 0) {
        comets.set(id, newComet(label, KIND_COLOR[kind], start))
        const p = planet()
        burst(p.x, p.y, KIND_COLOR[kind], 8)
      }
      feed.push({ id, label, kind, start })
      if (feed.length > 60) feed = feed.slice(-60)
      energy = Math.min(8, energy + 1.2)
      spinnerLabel = label
      $.ui.invalidate('ui.render')
    } catch { /* le panneau ne bloque jamais un outil */ }

    const ran = await next(e)

    try {
      running.delete(id)
      const ok = !('deny' in ran && ran.deny) && !ran.isError
      const item = feed.find(f => f.id === id)
      if (item) { item.end = now(); item.ok = ok }
      const cm = comets.get(id)
      if (cm) {
        const pos = orbitPos(cm)
        rings.push({ x: pos.x, y: pos.y, r: 0.5, max: 5, color: ok ? C.succes : C.erreur })
        burst(pos.x, pos.y, ok ? cm.color : C.erreur, ok ? 6 : 14)
      }
      const txt = typeof ran.text === 'string' ? ran.text : ''
      if (tool.startsWith('mcp__runway__generate_')) {
        const tid = txt.match(/"taskId"\s*:\s*"([^"]+)"/)?.[1]
        if (tid && !generations.has(tid) && W > 0) {
          const p = planet()
          generations.set(tid, { angle: rand(0, 6.28), orbit: Math.min(p.r * 3.6, (p.x - 6) / 2), speed: 0.01, color: C.runway, label: 'génération', start: now(), fade: 1 })
        }
      } else if (tool === 'mcp__runway__get_task') {
        const tid = typeof input.id === 'string' ? input.id : ''
        const g = generations.get(tid)
        if (g) {
          const gp = orbitPos(g)
          if (/"kind"\s*:\s*"(image|video)"|SUCCEEDED/.test(txt)) { rings.push({ x: gp.x, y: gp.y, r: 0.5, max: 12, color: C.runway }); burst(gp.x, gp.y, [C.or, C.runway, C.blanc], 30); generations.delete(tid) }
          else if (/FAILED|task_failed/.test(txt)) { burst(gp.x, gp.y, C.erreur, 20); generations.delete(tid) }
        }
      }
      const ms = now() - start
      if (ms > 30_000) $.ui.toast(`${ok ? '✓' : '✗'} ${label} (${fmt(ms)})`)
      const last = [...running.values()].pop()
      spinnerLabel = last ? last.label : null
      save($)
      $.ui.invalidate('ui.render')
    } catch { /* idem */ }

    return ran
  }).catch(($, e, next) => next(e))
}
