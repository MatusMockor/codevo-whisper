import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const [manifestFile] = process.argv.slice(2)

if (!manifestFile) {
  console.error('usage: node scripts/verify-feed.mjs <feed/latest-mac.yml>')
  process.exit(2)
}

const feedDir = path.dirname(manifestFile)
const manifest = yaml.load(fs.readFileSync(manifestFile, 'utf8'))

const sha512Of = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')

const check = (entry) => {
  const file = path.join(feedDir, entry.url)
  if (!fs.existsSync(file)) {
    return `${entry.url}: missing`
  }
  const size = fs.statSync(file).size
  if (size !== entry.size) {
    return `${entry.url}: size ${size} != ${entry.size}`
  }
  if (sha512Of(file) !== entry.sha512) {
    return `${entry.url}: sha512 mismatch`
  }
  return null
}

const problems = manifest.files.map(check).filter(Boolean)
const archs = ['arm64', 'x64'].filter((arch) => manifest.files.some((entry) => entry.url.endsWith('.zip') && entry.url.includes(`-${arch}-`)))

if (archs.length !== 2) {
  problems.push(`expected zip entries for arm64 and x64, found: ${archs.join(', ') || 'none'}`)
}

if (problems.length > 0) {
  problems.forEach((problem) => console.error(problem))
  process.exit(1)
}

manifest.files.forEach((entry) => console.log(`ok ${entry.url} size=${entry.size}`))
console.log(`feed ${manifest.version} valid: ${manifest.files.length} files, archs ${archs.join(', ')}`)
