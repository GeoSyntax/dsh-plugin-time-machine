import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const typeEntry = manifest.types
const exportEntry = manifest.exports?.['.']?.types
if (typeof typeEntry !== 'string' || typeof exportEntry !== 'string') {
  throw new Error('companion package must expose a TypeScript declaration entry')
}

const normalizedTypeEntry = typeEntry.replace(/^\.\//, '')
const normalizedExportEntry = exportEntry.replace(/^\.\//, '')
if (normalizedTypeEntry !== normalizedExportEntry) {
  throw new Error(`types and exports.types disagree: ${typeEntry} vs ${exportEntry}`)
}

const declaration = path.join(root, normalizedTypeEntry)
if (!fs.existsSync(declaration)) {
  throw new Error(`declared TypeScript entry does not exist: ${typeEntry}`)
}

const mainEntry = path.join(root, manifest.main)
if (!fs.existsSync(mainEntry)) {
  throw new Error(`declared main entry does not exist: ${manifest.main}`)
}

const allowedFiles = manifest.files ?? []
if (!allowedFiles.includes('lib')) {
  throw new Error('package must publish the built lib directory')
}

console.log(`companion package metadata ok (${manifest.main}, ${manifest.types})`)
