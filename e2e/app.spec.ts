import { expect, test } from '@playwright/test'

test('Introduce, lexicon, word page, atlas, and review', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Wordkeep' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Type a word/i })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Word or phrase to look up' })).toBeVisible()

  await page.getByRole('link', { name: 'Lexicon' }).click()
  await expect(page.getByRole('heading', { name: 'Lexicon' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  await page.getByPlaceholder('Search kept words').fill('happy')
  const happy = page.locator('span.lemma', { hasText: /^happy$/ })
  await expect(happy).toBeVisible({ timeout: 15_000 })
  await happy.click()
  await expect(page.getByRole('heading', { name: /^happy$/i })).toBeVisible()
  await expect(page.getByText(/feeling or showing pleasure/i).first()).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()

  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByRole('heading', { name: 'Atlas' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText(/Drag to rotate/i).first()).toBeVisible()

  await page.getByRole('link', { name: /Review/ }).click()
  await expect(page.getByRole('heading').first()).toBeVisible()
})

test('Phrases: mode toggle, lexicon filter, breakdown, and atlas', async ({ page }) => {
  await page.goto('/')
  const box = page.getByRole('combobox', { name: 'Word or phrase to look up' })
  await box.fill('I am very happy.')
  await expect(page.getByRole('button', { name: 'Phrase', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible()

  await page.getByRole('link', { name: 'Lexicon' }).click()
  await page.getByRole('button', { name: 'phrases', exact: true }).click()
  const phrase = page.locator('span.lemma', { hasText: 'I am very happy.' })
  await expect(phrase).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('span.lemma', { hasText: /^happy$/ })).toHaveCount(0)
  await phrase.click()

  await expect(page.getByRole('heading', { name: 'I am very happy.' })).toBeVisible()
  const strip = page.getByLabel('Word-by-word breakdown')
  await expect(strip.getByRole('link', { name: /am/ })).toHaveAttribute('href', '/?q=be&lang=en')
  await expect(page.getByText('present simple')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Re-analyze grammar' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByRole('link', { name: 'happy', exact: true }).last()).toBeVisible()
})

test('Discover page loads', async ({ page }) => {
  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: /Discover/i })).toBeVisible()
})

test('unknown routes redirect home', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByRole('heading', { name: /Type a word/i })).toBeVisible()
})
