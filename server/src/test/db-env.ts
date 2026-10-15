import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.WORDKEEP_DB ??= join(tmpdir(), `wordkeep-test-${process.pid}.db`)
process.env.WORDKEEP_TEST = '1'
process.env.WORDKEEP_SKIP_WARMUP = '1'
process.env.WORDKEEP_DISABLE_AI = '1'
process.env.WORDKEEP_AI_DAILY_PER_VISITOR ??= '1000'
process.env.WORDKEEP_AI_DAILY_TOTAL ??= '1000'
