import type { GraphNode, GraphPayload, LinkRelation } from '../../shared/types.ts'
import { db } from './db.ts'
import { allActiveWordRows, getWord, normalizeLemma } from './words.ts'

function nodeIdFor(wordId: string | null, lemma: string, language: string): string {
  return wordId ? `word:${wordId}` : `ghost:${language}:${lemma}`
}

export function wordGraph(centerId?: string): GraphPayload {
  if (centerId) {
    const center = getWord(centerId)
    if (!center) return { nodes: [], edges: [] }
    const centerNodeId = `word:${center.id}`
    const nodes: GraphPayload['nodes'] = [
      {
        id: centerNodeId,
        label: center.displayLemma,
        language: center.language,
        languageName: center.languageName,
        saved: true,
        wordId: center.id,
        kind: 'center',
      },
    ]
    const edges: GraphPayload['edges'] = []
    const phraseIds = new Set(
      (db.prepare(`SELECT id FROM words WHERE kind = 'phrase'`).all() as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    )
    const seenNode = new Set<string>([centerNodeId])

    function neighborKind(relation: LinkRelation, toWordId: string | null): GraphNode['kind'] {
      if (relation === 'phrase') {
        if (toWordId && phraseIds.has(toWordId)) return 'phrase'
        return toWordId ? 'saved' : 'related'
      }
      return relation
    }
    const seenEdge = new Set<string>()

    function addNeighbor(
      lemma: string,
      language: string,
      languageName: string,
      relation: LinkRelation,
      toWordId: string | null,
    ) {
      const id = nodeIdFor(toWordId, lemma, language)
      if (!seenNode.has(id)) {
        seenNode.add(id)
        const kind = neighborKind(relation, toWordId)
        nodes.push({
          id,
          label: lemma,
          language,
          languageName,
          saved: Boolean(toWordId),
          wordId: toWordId,
          kind,
        })
      }
      const edgeKey = [centerNodeId, id, relation].sort().join('|')
      if (seenEdge.has(edgeKey)) return
      seenEdge.add(edgeKey)
      edges.push({ source: centerNodeId, target: id, relation })
    }

    for (const link of center.links) {
      addNeighbor(link.lemma, link.language, link.languageName, link.relation, link.toWordId)
    }
    return { nodes, edges }
  }

  const words = allActiveWordRows()
  const nodes: GraphPayload['nodes'] = words.map((row) => ({
    id: `word:${row.id}`,
    label: row.display_lemma,
    language: row.language,
    languageName: row.language_name,
    saved: true,
    wordId: row.id,
    kind: row.kind === 'phrase' ? ('phrase' as const) : ('saved' as const),
  }))
  const byKey = new Map(
    words.map((row) => [`${row.language}:${normalizeLemma(row.display_lemma, row.language)}`, row.id]),
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: GraphPayload['edges'] = []
  const edgeSeen = new Set<string>()

  function pushEdge(sourceId: string, targetId: string, relation: LinkRelation) {
    const source = `word:${sourceId}`
    const target = `word:${targetId}`
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return
    const key = [source, target, relation].sort().join('|')
    if (edgeSeen.has(key)) return
    edgeSeen.add(key)
    edges.push({ source, target, relation })
  }

  const links = db
    .prepare(
      'SELECT from_word_id, to_word_id, to_lemma, to_language, to_language_name, relation FROM word_links',
    )
    .all() as Array<{
    from_word_id: string
    to_word_id: string | null
    to_lemma: string
    to_language: string
    to_language_name: string
    relation: LinkRelation
  }>

  const phraseIds = new Set(words.filter((row) => row.kind === 'phrase').map((row) => row.id))

  for (const link of links) {
    const targetId =
      link.to_word_id ?? byKey.get(`${link.to_language}:${link.to_lemma}`) ?? null
    if (targetId) {
      pushEdge(link.from_word_id, targetId, link.relation || 'translation')
      continue
    }
    // Words of a kept phrase show up even when they were never kept themselves.
    if (link.relation !== 'phrase' || !phraseIds.has(link.from_word_id)) continue
    const ghostId = `ghost:${link.to_language}:${link.to_lemma}`
    if (!nodeIds.has(ghostId)) {
      nodeIds.add(ghostId)
      nodes.push({
        id: ghostId,
        label: link.to_lemma,
        language: link.to_language,
        languageName: link.to_language_name,
        saved: false,
        wordId: null,
        kind: 'word',
      })
    }
    const source = `word:${link.from_word_id}`
    const key = [source, ghostId, 'phrase'].sort().join('|')
    if (edgeSeen.has(key)) continue
    edgeSeen.add(key)
    edges.push({ source, target: ghostId, relation: 'phrase' })
  }

  const senseRows = db
    .prepare('SELECT word_id, synonyms_json, antonyms_json FROM senses')
    .all() as Array<{ word_id: string; synonyms_json: string | null; antonyms_json: string | null }>
  const wordLang = new Map(words.map((row) => [row.id, row.language]))

  function parse(raw: string | null): string[] {
    if (!raw) return []
    try {
      const value = JSON.parse(raw) as unknown
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  for (const row of senseRows) {
    const language = wordLang.get(row.word_id)
    if (!language) continue
    for (const term of parse(row.synonyms_json).slice(0, 8)) {
      const other = byKey.get(`${language}:${normalizeLemma(term, language)}`)
      if (other) pushEdge(row.word_id, other, 'synonym')
    }
    for (const term of parse(row.antonyms_json).slice(0, 8)) {
      const other = byKey.get(`${language}:${normalizeLemma(term, language)}`)
      if (other) pushEdge(row.word_id, other, 'antonym')
    }
  }

  return { nodes, edges }
}
