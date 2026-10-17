import { readFile, stat } from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
const base = '/card-balance/'

async function text(name) {
  return readFile(new URL(name, dist), 'utf8')
}

async function requireFile(name) {
  const info = await stat(new URL(name, dist))
  if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty dist/${name}`)
}

for (const file of [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png'
]) await requireFile(file)

const index = await text('index.html')
if (!index.includes(`${base}manifest.webmanifest`)) throw new Error('Manifest path does not use the GitHub Pages base path')
if (!index.includes(`${base}apple-touch-icon.png`)) throw new Error('Apple touch icon path is incorrect')
if (/(["'])\/(?!card-balance\/)/.test(index)) throw new Error('Root-absolute asset path found in index.html')

const manifest = JSON.parse(await text('manifest.webmanifest'))
if (manifest.id !== base || manifest.start_url !== base || manifest.scope !== base) {
  throw new Error('Manifest id/start_url/scope do not match the GitHub Pages base path')
}
if (manifest.lang !== 'el') throw new Error('Manifest language is not Greek')
if (!manifest.icons?.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable')) {
  throw new Error('A 512x512 maskable icon is required')
}

const worker = await text('sw.js')
if (!worker.includes('card-balance/index.html')) throw new Error('Service Worker navigation fallback is outside the project base path')

await stat(new URL('assets/', dist))
console.log('Verified GitHub Pages paths, manifest, icons and Service Worker.')
