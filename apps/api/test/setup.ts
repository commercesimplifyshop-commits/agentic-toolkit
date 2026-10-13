import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated data dir for tests (paths.ts reads it at import time)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-toolkit-test-'))
process.env.AGENTIC_TOOLKIT_DATA = dir
