import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GraphEdge, GraphNode } from '@shared/types'
import { hashHue } from '../lib/format'
import { useI18n } from '../context/I18nContext'
import { useTheme } from '../context/ThemeContext'
import { keptHref, lookupHref } from '../lib/paths'

type Body = GraphNode & {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

const MAJOR = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'nl',
  'pl', 'sv', 'tr', 'el', 'la', 'fi', 'cs', 'uk', 'he', 'th', 'vi', 'id', 'ro',
  'hu', 'da', 'nb', 'fa', 'ca', 'gl', 'eo', 'sw', 'bn', 'ta', 'te', 'ms',
])

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

function nodeFill(node: GraphNode, root: HTMLElement): string {
  if (node.kind === 'center') return cssVar(root, '--wk-ink', '#f0e8dc')
  if (node.kind === 'synonym') return cssVar(root, '--wk-saved', '#7dbaa8')
  if (node.kind === 'antonym') return cssVar(root, '--wk-accent', '#e07a66')
  if (node.kind === 'translation') return cssVar(root, '--wk-gold', '#d4b072')
  if (node.kind === 'related') return cssVar(root, '--wk-related', '#8eb4d4')
  if (node.kind === 'etymology') return cssVar(root, '--wk-etymology', '#c49bc8')
  if (node.kind === 'phrase') return cssVar(root, '--wk-phrase', '#b5c46a')
  return `hsl(${hashHue(node.language)}, 42%, 46%)`
}

function relationColor(relation: string, root: HTMLElement): string {
  if (relation === 'synonym') return cssVar(root, '--wk-saved', '#7dbaa8')
  if (relation === 'antonym') return cssVar(root, '--wk-accent', '#e07a66')
  if (relation === 'translation') return cssVar(root, '--wk-gold', '#d4b072')
  if (relation === 'related') return cssVar(root, '--wk-related', '#8eb4d4')
  if (relation === 'etymology') return cssVar(root, '--wk-etymology', '#c49bc8')
  if (relation === 'phrase') return cssVar(root, '--wk-phrase', '#b5c46a')
  return cssVar(root, '--wk-rule', '#3a332c')
}

function isDashed(relation: string): boolean {
  return relation === 'antonym' || relation === 'related' || relation === 'etymology'
}

function seedBodies(nodes: GraphNode[]): Body[] {
  const n = Math.max(nodes.length, 1)
  return nodes.map((node, index) => {
    const phi = Math.acos(1 - (2 * (index + 0.5)) / n)
    const theta = Math.PI * (1 + Math.sqrt(5)) * index
    const radius = 28 + Math.min(n, 40) * 0.9
    return {
      ...node,
      x: Math.cos(theta) * Math.sin(phi) * radius,
      y: Math.cos(phi) * radius * 0.72,
      z: Math.sin(theta) * Math.sin(phi) * radius,
      vx: 0,
      vy: 0,
      vz: 0,
    }
  })
}

function stepForce(bodies: Body[], links: Array<{ source: Body; target: Body }>) {
  const n = bodies.length
  const charge = 140 + n * 2.4
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = bodies[i]
      const b = bodies[j]
      if (!a || !b) continue
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dz = a.z - b.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.08
      const force = charge / (dist * dist)
      dx = (dx / dist) * force
      dy = (dy / dist) * force
      dz = (dz / dist) * force
      a.vx += dx
      a.vy += dy
      a.vz += dz
      b.vx -= dx
      b.vy -= dy
      b.vz -= dz
    }
  }
  const rest = n > 24 ? 14 : 18
  for (const link of links) {
    const dx = link.target.x - link.source.x
    const dy = link.target.y - link.source.y
    const dz = link.target.z - link.source.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.08
    const pull = (dist - rest) * 0.06
    const fx = (dx / dist) * pull
    const fy = (dy / dist) * pull
    const fz = (dz / dist) * pull
    link.source.vx += fx
    link.source.vy += fy
    link.source.vz += fz
    link.target.vx -= fx
    link.target.vy -= fy
    link.target.vz -= fz
  }
  const limit = 36 + Math.min(n, 40) * 0.35
  for (const node of bodies) {
    node.vx += -node.x * 0.02
    node.vy += -node.y * 0.02
    node.vz += -node.z * 0.02
    node.vx *= 0.78
    node.vy *= 0.78
    node.vz *= 0.78
    node.x += node.vx
    node.y += node.vy
    node.z += node.vz
    const radius = Math.hypot(node.x, node.y, node.z)
    if (radius > limit) {
      const scale = limit / radius
      node.x *= scale
      node.y *= scale
      node.z *= scale
      node.vx *= 0.4
      node.vy *= 0.4
      node.vz *= 0.4
    }
  }
}

function makeLabel(lemma: string, lang: string, ink: string, muted: string, plate: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 0.88
    ctx.fillStyle = plate
    ctx.beginPath()
    ctx.roundRect(12, 8, 360, 80, 16)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 34px Newsreader, Georgia, serif'
    ctx.fillStyle = ink
    ctx.fillText(lemma, 192, 36, 340)
    ctx.font = '600 16px Figtree, system-ui, sans-serif'
    ctx.fillStyle = muted
    ctx.fillText(lang.toUpperCase(), 192, 68)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(22, 5.5, 1)
  sprite.center.set(0.5, 1.25)
  sprite.raycast = () => undefined
  return sprite
}

export function WordGraph({
  nodes,
  edges,
  height = 420,
  cap = 48,
  onLookup,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  height?: number
  cap?: number
  onLookup?: (lemma: string, language: string) => void
}) {
  const navigate = useNavigate()
  const { resolved: theme } = useTheme()
  const { t } = useI18n()
  const wrapRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [noGl, setNoGl] = useState(false)

  const trimmed = useMemo(() => {
    const center = nodes.find((node) => node.kind === 'center')
    if (!center || nodes.length <= cap) return { nodes, edges }
    const ranked = nodes
      .filter((node) => node.id !== center.id)
      .sort((a, b) => Number(b.saved) - Number(a.saved) || Number(MAJOR.has(b.language)) - Number(MAJOR.has(a.language)))
      .slice(0, cap - 1)
    const keep = new Set([center.id, ...ranked.map((node) => node.id)])
    return {
      nodes: [center, ...ranked],
      edges: edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    }
  }, [nodes, edges, cap])

  useEffect(() => {
    const host = hostRef.current
    const wrap = wrapRef.current
    if (!host || !wrap || !trimmed.nodes.length) return

    const width = host.clientWidth || 640
    const ink = cssVar(wrap, '--wk-ink', '#f0e8dc')
    const muted = cssVar(wrap, '--wk-muted', '#b3a99b')
    const paper = cssVar(wrap, '--wk-paper-2', '#201b16')
    const plate = cssVar(wrap, '--wk-paper', '#161310')

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(paper)

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 800)
    camera.position.set(48, 32, 88)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    } catch {
      // No WebGL (blocked, old device, or out of contexts): list the links instead.
      setNoGl(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = `${height}px`
    renderer.domElement.style.userSelect = 'none'
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.setAttribute('aria-label', t('graph.aria'))
    host.replaceChildren(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.9
    controls.enablePan = false
    controls.minDistance = 24
    controls.maxDistance = 480
    controls.target.set(0, 0, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 0.9)
    key.position.set(40, 70, 90)
    scene.add(key)

    const bodies = seedBodies(trimmed.nodes)
    const byId = new Map(bodies.map((body) => [body.id, body]))
    const forceLinks = trimmed.edges.flatMap((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      return source && target ? [{ source, target, relation: edge.relation }] : []
    })
    for (let i = 0; i < 80; i += 1) stepForce(bodies, forceLinks)
    scene.fog = new THREE.Fog(paper, 120, 260)
    const nodeScale = 2.15
    const labelW = 18
    const labelH = 4.6
    const sphere = new THREE.SphereGeometry(1, 24, 18)
    const meshes: THREE.Mesh[] = []
    const labels: THREE.Sprite[] = []
    const group = new THREE.Group()
    scene.add(group)

    for (const body of bodies) {
      const radius = (body.kind === 'center' ? 1.55 : body.saved ? 1 : 0.78) * nodeScale
      const color = new THREE.Color(nodeFill(body, wrap))
      const material = new THREE.MeshLambertMaterial({ color })
      const mesh = new THREE.Mesh(sphere, material)
      mesh.scale.setScalar(radius)
      mesh.position.set(body.x, body.y, body.z)
      mesh.userData.body = body
      group.add(mesh)
      meshes.push(mesh)

      const label = makeLabel(body.label, body.language, ink, muted, plate)
      label.scale.set(labelW, labelH, 1)
      label.position.set(body.x, body.y + radius + labelH * 0.15, body.z)
      group.add(label)
      labels.push(label)
    }

    const lineObjects: THREE.Line[] = []
    for (const link of forceLinks) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(link.source.x, link.source.y, link.source.z),
        new THREE.Vector3(link.target.x, link.target.y, link.target.z),
      ])
      const dashed = isDashed(link.relation)
      const material = dashed
        ? new THREE.LineDashedMaterial({
            color: new THREE.Color(relationColor(link.relation, wrap)),
            dashSize: nodeScale * 0.7,
            gapSize: nodeScale * 0.45,
            transparent: true,
            opacity: 0.95,
            linewidth: 2,
          })
        : new THREE.LineBasicMaterial({
            color: new THREE.Color(relationColor(link.relation, wrap)),
            transparent: true,
            opacity: 0.95,
            linewidth: 2,
          })
      const line = new THREE.Line(geometry, material)
      if (dashed) line.computeLineDistances()
      group.add(line)
      lineObjects.push(line)
    }

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0
    let downY = 0
    let running = true
    let frame = 0
    let cooling = 1

    function sync() {
      for (let i = 0; i < bodies.length; i += 1) {
        const body = bodies[i]
        const mesh = meshes[i]
        const label = labels[i]
        if (!body || !mesh || !label) continue
        mesh.position.set(body.x, body.y, body.z)
        const radius = (body.kind === 'center' ? 1.55 : body.saved ? 1 : 0.78) * nodeScale
        label.position.set(body.x, body.y + radius + labelH * 0.15, body.z)
      }
      for (let i = 0; i < forceLinks.length; i += 1) {
        const link = forceLinks[i]
        const line = lineObjects[i]
        if (!link || !line) continue
        const positions = line.geometry.getAttribute('position')
        if (!positions) continue
        positions.setXYZ(0, link.source.x, link.source.y, link.source.z)
        positions.setXYZ(1, link.target.x, link.target.y, link.target.z)
        positions.needsUpdate = true
        if (isDashed(link.relation)) line.computeLineDistances()
      }
    }

    function activate(body: Body) {
      if (body.wordId) navigate(keptHref(body.wordId))
      else if (onLookup) onLookup(body.label, body.language)
      else navigate(lookupHref(body.label, body.language))
    }

    function onPointerDown(event: PointerEvent) {
      downX = event.clientX
      downY = event.clientY
    }

    function onPointerUp(event: PointerEvent) {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(meshes, false)[0]
      const body = hit?.object.userData.body as Body | undefined
      if (body) activate(body)
    }

    function onContext(event: Event) {
      event.preventDefault()
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('contextmenu', onContext)
    renderer.domElement.addEventListener('selectstart', onContext)

    const observer = new ResizeObserver(() => {
      const next = host.clientWidth || width
      camera.aspect = next / height
      camera.updateProjectionMatrix()
      renderer.setSize(next, height)
    })
    observer.observe(host)

    function tick() {
      if (!running) return
      frame = requestAnimationFrame(tick)
      if (cooling > 0.04) {
        stepForce(bodies, forceLinks)
        sync()
        cooling *= 0.986
      }
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      running = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('contextmenu', onContext)
      renderer.domElement.removeEventListener('selectstart', onContext)
      controls.dispose()
      sphere.dispose()
      for (const mesh of meshes) {
        ;(mesh.material as THREE.Material).dispose()
      }
      for (const label of labels) {
        const material = label.material
        material.map?.dispose()
        material.dispose()
      }
      for (const line of lineObjects) {
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
      }
      renderer.dispose()
      host.replaceChildren()
    }
  }, [trimmed, height, navigate, onLookup, theme, t])

  if (!nodes.length) {
    return (
      <p className="rounded-2xl border border-dashed border-rule px-4 py-10 text-center text-muted">
        {t('graph.empty')}
      </p>
    )
  }

  if (noGl) {
    return (
      <div className="rounded-2xl border border-rule bg-paper-2 p-4">
        <p className="mb-3 text-sm text-muted">{t('graph.noGl')}</p>
        <ul className="flex flex-wrap gap-2">
          {trimmed.nodes.map((node) => (
            <li key={node.id}>
              <Link
                to={node.wordId ? keptHref(node.wordId) : lookupHref(node.label, node.language)}
                className={`lemma inline-block rounded-full border px-3 py-1 ${
                  node.kind === 'center' ? 'border-ink bg-ink text-paper' : 'border-rule bg-paper'
                }`}
              >
                {node.label}
                <span className="ml-1 font-mono text-xs uppercase opacity-70">{node.language}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      className="select-none overflow-hidden rounded-2xl border border-rule bg-paper-2"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div
        ref={hostRef}
        className="cursor-grab active:cursor-grabbing"
        style={{ height, touchAction: 'none', userSelect: 'none' }}
      />
      <p className="border-t border-rule px-3 py-1.5 text-center text-xs text-muted">
        {t('graph.hint')}
      </p>
      <div className="flex flex-wrap gap-3 border-t border-rule px-3 py-2 text-xs uppercase tracking-wide text-muted">
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-4 rounded-sm" style={{ background: 'var(--wk-saved)' }} />
          {t('relation.synonym')}
        </span>
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-0.5 w-4"
            style={{ borderTop: '2px dashed var(--wk-accent)' }}
          />
          {t('relation.antonym')}
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-4 rounded-sm" style={{ background: 'var(--wk-gold)' }} />
          {t('relation.translation')}
        </span>
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-0.5 w-4"
            style={{ borderTop: '2px dotted var(--wk-related)' }}
          />
          {t('relation.related')}
        </span>
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-0.5 w-4"
            style={{ borderTop: '2px dashed var(--wk-etymology)' }}
          />
          {t('relation.etymology')}
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-4 rounded-sm" style={{ background: 'var(--wk-phrase)' }} />
          {t('relation.phrase')}
        </span>
      </div>
      {nodes.length > trimmed.nodes.length && (
        <p className="border-t border-rule px-3 py-2 text-center text-xs text-muted">
          {t('graph.showing', { shown: trimmed.nodes.length - 1, total: nodes.length - 1 })}
        </p>
      )}
    </div>
  )
}
