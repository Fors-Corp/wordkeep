import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.WORDKEEP_DB ??= join(tmpdir(), `wordkeep-test-${process.pid}.db`)
process.env.WORDKEEP_TEST = '1'
process.env.WORDKEEP_SKIP_SEED = '1'
process.env.WORDKEEP_SKIP_WARMUP = '1'
process.env.WORDKEEP_DISABLE_AI = '1'
