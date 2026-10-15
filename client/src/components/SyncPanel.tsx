import { useState, type FormEvent } from 'react'
import { formatSyncKey, normalizeSyncKey } from '@shared/sync'
import { useI18n } from '../context/I18nContext'
import { useLexicon } from '../context/LexiconContext'
import { errorText } from '../lib/errors'

/** Turns sync on or off for this device and shows the private code that links devices. */
export function SyncPanel() {
  const { device, sync } = useLexicon()
  const { t, locale } = useI18n()
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [copied, setCopied] = useState(false)

  async function turnOn() {
    setCodeError('')
    await device?.startSync()
  }

  async function join(event: FormEvent) {
    event.preventDefault()
    if (!normalizeSyncKey(code)) {
      setCodeError(t('sync.badCode'))
      return
    }
    setCodeError('')
    setJoining(false)
    setCode('')
    await device?.startSync(code)
  }

  function turnOff() {
    if (window.confirm(t('sync.turnOffConfirm'))) device?.stopSync()
  }

  async function copy() {
    if (!sync.key) return
    try {
      await navigator.clipboard.writeText(formatSyncKey(sync.key))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the code stays selectable on screen */
    }
  }

  function statusText(): string {
    switch (sync.status) {
      case 'syncing':
        return t('sync.status.syncing')
      case 'ok':
        return sync.lastSyncedAt
          ? t('sync.status.ok', {
              time: new Date(sync.lastSyncedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
            })
          : t('sync.status.idle')
      case 'unavailable':
        return t('sync.status.unavailable')
      case 'error':
        return t('sync.status.error', { error: errorText(sync.error, t) })
      default:
        return t('sync.status.idle')
    }
  }

  return (
    <section className="mt-10 rounded-3xl border border-rule bg-paper-2 p-5" aria-labelledby="sync-title">
      <h2 id="sync-title" className="lemma text-2xl">
        {t('sync.title')}
      </h2>
      {!sync.key ? (
        <>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('sync.offIntro')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void turnOn()}
              disabled={!device}
              className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
            >
              {t('sync.turnOn')}
            </button>
            <button
              type="button"
              onClick={() => setJoining((open) => !open)}
              aria-expanded={joining}
              disabled={!device}
              className="rounded-full border border-rule px-4 py-2 text-sm disabled:opacity-50"
            >
              {t('sync.haveCode')}
            </button>
          </div>
          {joining && (
            <form onSubmit={(event) => void join(event)} className="mt-4 flex max-w-md flex-wrap gap-2">
              <label className="min-w-0 flex-1 text-sm">
                <span className="sr-only">{t('sync.codeLabel')}</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="ABCD-EFGH-…"
                  aria-label={t('sync.codeLabel')}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-full border border-rule bg-paper px-4 py-2 font-mono text-base uppercase outline-none focus:border-accent sm:text-sm"
                />
              </label>
              <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-paper">
                {t('sync.connect')}
              </button>
              {codeError && <p className="w-full text-sm text-accent">{codeError}</p>}
            </form>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('sync.onIntro')}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code
              className="select-all rounded-xl border border-rule bg-paper px-3 py-2 font-mono text-sm tracking-wider break-all"
              aria-label={t('sync.codeLabel')}
            >
              {formatSyncKey(sync.key)}
            </code>
            <button type="button" onClick={() => void copy()} className="rounded-full border border-rule px-3 py-1.5 text-sm">
              {copied ? t('sync.copied') : t('sync.copy')}
            </button>
          </div>
          <p
            className={`mt-3 text-sm ${sync.status === 'error' || sync.status === 'unavailable' ? 'text-accent' : 'text-muted'}`}
            role="status"
          >
            {statusText()}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void device?.syncNow()}
              disabled={sync.status === 'syncing'}
              className="rounded-full border border-rule px-4 py-2 text-sm disabled:opacity-50"
            >
              {t('sync.now')}
            </button>
            <button type="button" onClick={() => turnOff()} className="rounded-full px-4 py-2 text-sm text-accent">
              {t('sync.turnOff')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
