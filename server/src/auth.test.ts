import './test/db-env.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.WORDKEEP_ACCESS_KEY = 'open sesame'
process.env.TRUST_PROXY = '1'
const { app } = await import('./app.ts')

function login(key: string, ip = '203.0.113.7') {
  return app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ key }),
  })
}

describe('access key', () => {
  it('locks the API until signed in, with a session cookie that is not the key', async () => {
    assert.equal((await app.request('/api/sync', { method: 'POST', body: '{}' })).status, 401)
    assert.equal((await app.request('/api/legacy/export')).status, 401)
    assert.equal((await app.request('/api/health')).status, 200)

    const wrong = await login('nope')
    assert.equal(wrong.status, 401)
    assert.equal(((await wrong.json()) as { code: string }).code, 'wrong-key')

    const ok = await login('open sesame')
    assert.equal(ok.status, 200)
    const cookie = ok.headers.get('set-cookie') ?? ''
    assert.match(cookie, /wordkeep_session=[0-9a-f]{64}/)
    assert.doesNotMatch(cookie, /open/)
    assert.doesNotMatch(cookie, /Secure/)

    const session = cookie.split(';')[0]!
    const res = await app.request('/api/session', { headers: { cookie: session } })
    assert.deepEqual(await res.json(), { ok: true, locked: true, signedIn: true })
    assert.equal((await app.request('/api/legacy/export', { headers: { cookie: session } })).status, 200)
    assert.equal(
      (await app.request('/api/legacy/export', { headers: { authorization: 'Bearer open sesame' } })).status,
      200,
    )
    assert.equal((await app.request('/api/legacy/export', { headers: { cookie: 'wordkeep_key=open sesame' } })).status, 401)
  })

  it('marks the cookie Secure behind HTTPS', async () => {
    const res = await app.request('https://wordkeep.example/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'open sesame' }),
    })
    assert.match(res.headers.get('set-cookie') ?? '', /Secure/)
  })

  it('pauses logins after ten wrong keys', async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await login('guess', '198.51.100.9')).status, 401)
    const blocked = await login('open sesame', '198.51.100.9')
    assert.equal(blocked.status, 429)
    assert.equal((await login('open sesame', '198.51.100.10')).status, 200)
  })
})
