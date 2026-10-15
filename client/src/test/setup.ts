import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach } from 'vitest'

// Each test starts with an empty device.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => cleanup())
