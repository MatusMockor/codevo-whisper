import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const [outFile, ...inputs] = process.argv.slice(2)

if (!outFile || inputs.length < 2) {
  console.error('usage: node scripts/merge-latest-mac.mjs <out.yml> <latest-mac.yml> <latest-mac.yml> [...]')
  process.exit(2)
}

const manifests = inputs.map((file) => yaml.load(fs.readFileSync(file, 'utf8')))
const versions = new Set(manifests.map((manifest) => manifest.version))

if (versions.size !== 1) {
  console.error(`version mismatch: ${[...versions].join(', ')}`)
  process.exit(1)
}

const byUrl = new Map()
manifests.flatMap((manifest) => manifest.files).forEach((file) => byUrl.set(file.url, file))
const files = [...byUrl.values()]

const invalid = files.filter((file) => !file.url || !file.sha512 || !Number.isInteger(file.size))
if (invalid.length > 0) {
  console.error(`invalid file entries: ${JSON.stringify(invalid)}`)
  process.exit(1)
}

const zips = files.filter((file) => file.url.endsWith('.zip'))
if (zips.length === 0) {
  console.error('no zip entries, MacUpdater needs a zip')
  process.exit(1)
}

const primary = zips.find((file) => !file.url.includes('arm64')) ?? zips[0]
const releaseDates = manifests.map((manifest) => manifest.releaseDate).filter(Boolean).sort()

const merged = {
  version: manifests[0].version,
  files,
  path: primary.url,
  sha512: primary.sha512,
  releaseDate: releaseDates[releaseDates.length - 1]
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, yaml.dump(merged, { lineWidth: -1 }))
console.log(`merged ${files.length} files for ${merged.version} into ${outFile}`)
