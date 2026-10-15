import { expect, test, type Page } from '@playwright/test'

async function loadSamples(page: Page) {
  await page.goto('/words')
  await page.getByRole('button', { name: 'Load sample words' }).click()
  await expect(page.locator('span.lemma', { hasText: /^happy$/ })).toBeVisible()
}

test('Introduce, lexicon, word page, atlas, and review', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Wordkeep' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Type a word/i })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Word or phrase to look up' })).toBeVisible()

  await page.getByRole('link', { name: 'Lexicon' }).click()
  await expect(page.getByRole('heading', { name: 'Lexicon' })).toBeVisible()
  await expect(page.getByText(/Nothing here yet/)).toBeVisible()
  await loadSamples(page)
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  await page.getByPlaceholder('Search kept words').fill('happy')
  const happy = page.locator('span.lemma', { hasText: /^happy$/ })
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
  await loadSamples(page)
  await page.goto('/')
  const box = page.getByRole('combobox', { name: 'Word or phrase to look up' })
  await box.fill('I am very happy.')
  await expect(page.getByRole('button', { name: 'Phrase', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible()

  await page.getByRole('link', { name: 'Lexicon' }).click()
  await page.getByRole('button', { name: 'phrases', exact: true }).click()
  const phrase = page.locator('span.lemma', { hasText: 'I am very happy.' })
  await expect(phrase).toBeVisible()
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

test('a kept word stays on the device after reloading', async ({ page }) => {
  await page.route('**/api/lookup**', (route) =>
    route.fulfill({
      json: {
        lemma: 'serendipity',
        displayLemma: 'serendipity',
        language: 'en',
        languageName: 'English',
        phonetic: null,
        etymology: 'Coined by Horace Walpole in 1754.',
        fallbackFrom: null,
        forms: [],
        senses: [
          {
            partOfSpeech: 'noun',
            definition: 'Finding something good without looking for it.',
            examples: [],
            synonyms: [],
            antonyms: [],
            tags: [],
          },
        ],
        translations: [{ lemma: 'serendipia', language: 'es', languageName: 'Spanish' }],
        existing: null,
      },
    }),
  )
  await page.goto('/?q=serendipity&lang=en')
  await page.getByRole('button', { name: 'Keep for recall' }).click()
  await expect(page.getByRole('heading', { name: 'serendipity' })).toBeVisible()
  const url = page.url()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'serendipity' })).toBeVisible()
  await expect(page.getByText('Finding something good without looking for it.')).toBeVisible()
  expect(page.url()).toBe(url)

  await page.goto('/?q=serendipity&lang=en')
  await expect(page.getByText('Already in your lexicon.')).toBeVisible()
})

test('two devices share one lexicon through a sync code', async ({ browser }) => {
  const phone = await (await browser.newContext()).newPage()
  const laptop = await (await browser.newContext()).newPage()

  await loadSamples(phone)
  await phone.getByRole('button', { name: 'Turn on sync' }).click()
  const code = (await phone.getByLabel('Sync code').textContent())?.trim() ?? ''
  expect(code).toMatch(/^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/)
  await expect(phone.getByText(/Up to date/)).toBeVisible()

  await laptop.goto('/words')
  await expect(laptop.getByText(/Nothing here yet/)).toBeVisible()
  await laptop.getByRole('button', { name: 'I have a code' }).click()
  await laptop.getByRole('textbox', { name: 'Sync code' }).fill(code)
  await laptop.getByRole('button', { name: 'Connect' }).click()
  await expect(laptop.locator('span.lemma', { hasText: /^happy$/ })).toBeVisible()
  await expect(laptop.getByText(/Up to date/)).toBeVisible()

  // A deletion on the laptop reaches the phone.
  await laptop.locator('span.lemma', { hasText: /^glad$/ }).click()
  laptop.once('dialog', (dialog) => void dialog.accept())
  await laptop.getByRole('button', { name: 'Delete' }).click()
  await expect(laptop.getByRole('heading', { name: 'Lexicon' })).toBeVisible()
  await laptop.getByRole('button', { name: 'Sync now' }).click()
  await expect(laptop.getByText(/Up to date/)).toBeVisible()

  await phone.getByRole('button', { name: 'Sync now' }).click()
  await expect(phone.locator('span.lemma', { hasText: /^glad$/ })).toHaveCount(0)
  await expect(phone.locator('span.lemma', { hasText: /^happy$/ })).toBeVisible()
})

test('two tabs on one device see each other\'s changes', async ({ context }) => {
  const first = await context.newPage()
  await loadSamples(first)
  const second = await context.newPage()
  await second.goto('/words')
  await expect(second.locator('span.lemma', { hasText: /^glad$/ })).toBeVisible()

  await second.locator('span.lemma', { hasText: /^glad$/ }).click()
  second.once('dialog', (dialog) => void dialog.accept())
  await second.getByRole('button', { name: 'Delete' }).click()
  // The first tab drops it without a reload.
  await expect(first.locator('span.lemma', { hasText: /^glad$/ })).toHaveCount(0)
  await expect(first.locator('span.lemma', { hasText: /^happy$/ })).toBeVisible()
})

test('phone: the dictionary language menu stays on screen', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true })).newPage()
  await page.goto('/')
  await page.getByRole('button', { name: /Dictionary language/ }).click()
  const search = page.getByRole('textbox', { name: 'Dictionary language' })
  await expect(search).toBeFocused()
  const box = (await search.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(375)
  expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
})

test('review shortcuts leave links and buttons alone', async ({ page }) => {
  await loadSamples(page)
  await page.goto('/review')
  await expect(page.getByRole('button', { name: /Again/ })).toBeDisabled()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Again/ })).toBeEnabled()
  await page.getByRole('link', { name: 'Lexicon' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/words$/)
})

test('Discover page loads', async ({ page }) => {
  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: /Discover/i })).toBeVisible()
})

test('unknown routes redirect home', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByRole('heading', { name: /Type a word/i })).toBeVisible()
})
