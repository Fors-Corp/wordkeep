import type { SenseDraft } from '@shared/types'
import { useI18n } from '../context/I18nContext'
import { posLabel } from '../lib/format'
import { groupByPos } from '../lib/senses'
import { SenseExtras } from './SenseExtras'

type Item = SenseDraft & { id?: string }

export function SenseList({
  senses,
  language,
  primaryId,
  primaryIndex,
  onPick,
}: {
  senses: Item[]
  language: string
  primaryId?: string | null
  primaryIndex?: number
  onPick?: (index: number, sense: Item) => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      {groupByPos(senses).map(([pos, group]) => (
        <section key={pos}>
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-accent">{posLabel(pos, t)}</h3>
          <ul className="space-y-2">
            {group.map((sense) => {
              const index = senses.indexOf(sense)
              const selected =
                primaryId != null && sense.id
                  ? sense.id === primaryId
                  : primaryIndex === index
              return (
                <li
                  key={sense.id ?? `${pos}-${index}`}
                  className={`rounded-xl p-3 ${selected ? 'bg-paper-2 ring-1 ring-gold/40' : 'border border-rule'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {onPick ? (
                      <button
                        type="button"
                        onClick={() => onPick(index, sense)}
                        className="flex-1 text-left font-medium"
                      >
                        {sense.definition}
                      </button>
                    ) : (
                      <p className="font-medium">{sense.definition}</p>
                    )}
                    {selected && (
                      <span className="shrink-0 text-xs uppercase tracking-wide text-gold">
                        {t('sense.cardFace')}
                      </span>
                    )}
                  </div>
                  <SenseExtras sense={sense} language={language} />
                  {onPick && !selected && sense.id && (
                    <button
                      type="button"
                      className="mt-2 text-xs text-accent underline"
                      onClick={() => onPick(index, sense)}
                    >
                      {t('sense.useOnCard')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
