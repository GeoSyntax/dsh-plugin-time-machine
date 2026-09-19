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

const peers = manifest.peerDependencies ?? {}
const dshPeers = [
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-session',
]
for (const name of dshPeers) {
  if (peers[name] !== '>=0.1.6-alpha.1 <0.2.0') {
    throw new Error(`${name} must stay within the tested DSH 0.1.x range`)
  }
}
if (peers['@deepseek-ai/cordis'] !== '>=4.0.0 <5.0.0') {
  throw new Error('Cordis peer range must stay within the tested 4.x line')
}
if (peers['dsh-plugin-time-machine'] !== '>=0.2.0 <0.3.0') {
  throw new Error('core plugin peer range must stay within the tested 0.2.x line')
}

console.log(`companion package metadata ok (${manifest.main}, ${manifest.types})`)
