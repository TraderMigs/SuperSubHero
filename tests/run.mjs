// Runs every *.test.mjs in this folder. Plain Node, no test framework, no dependencies.
// Each suite prints its own checks and exits non-zero on failure.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const dir = new URL('.', import.meta.url)
const suites = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()

let failed = []
for (const suite of suites) {
  console.log(`\n${'='.repeat(60)}\n${suite}\n${'='.repeat(60)}`)
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(suite, dir))], { stdio: 'inherit' })
  if (r.status !== 0) failed.push(suite)
}

console.log(`\n${'='.repeat(60)}`)
if (failed.length) {
  console.log(`FAILED: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`All ${suites.length} suite(s) passed.`)
