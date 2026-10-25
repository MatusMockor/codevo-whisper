import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const path = join(homedir(), 'Library/Logs/CodevoWhisperSpike/macos-input.jsonl')
const entries = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const [runArg, ...types] = process.argv.slice(2)
const runId = runArg && runArg !== 'last' ? runArg : entries.at(-1)?.runId
const skipped = new Set(['ts', 't', 'runId', 'type'])

const compact = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !skipped.has(key)))

entries
  .filter((entry) => entry.runId === runId)
  .filter((entry) => types.length === 0 || types.includes(entry.type))
  .forEach((entry) => console.log(`${entry.ts.slice(11, 23)} ${entry.type} ${JSON.stringify(compact(entry))}`))
