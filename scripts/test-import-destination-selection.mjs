import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const importerPaths = [
  '../app/admin/bid-lines/bid-line-importer.tsx',
  '../app/admin/bid-times/bid-time-importer.tsx',
]

for (const importerPath of importerPaths) {
  const source = await readFile(new URL(importerPath, import.meta.url), 'utf8')

  assert.doesNotMatch(
    source,
    /setAreaCode\(nextAreas\[0\]\?\.code/,
    `${importerPath} must not silently choose the first area`,
  )
  assert.match(
    source,
    /<option value="" disabled>Select an area<\/option>/,
    `${importerPath} must present an explicit area placeholder`,
  )
  assert.match(
    source,
    /disabled=\{busy \|\| !file \|\| !areaCode\}/,
    `${importerPath} must block preview until an area is selected`,
  )
}

console.log('Import destination selection regression checks passed.')
