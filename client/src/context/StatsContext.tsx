import { useLexicon } from './LexiconContext'

/** Today's numbers and the latest kept entries, worked out from the lexicon on this device. */
export function useStats() {
  const { stats, recent } = useLexicon()
  return { stats, recent }
}
