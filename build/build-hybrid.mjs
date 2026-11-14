import Module from 'node:module'
import {existsSync, readFileSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const {build} = await import(process.env.MV_ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'content', 'hybrid')

await build({
  absWorkingDir: root,
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [],
  entryPoints: ['build/hybrid-entry.js'],
  outfile: 'content/hybrid/editor.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  external: ['node:*'],
  target: ['chrome110', 'firefox115'],
  minify: true,
  sourcemap: false,
  legalComments: 'linked',
  assetNames: '[name]-[hash]',
  loader: {
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
  define: {'process.env.NODE_ENV': '"production"'},
  logLevel: 'info',
})

const packageRoots = [path.join(root, 'node_modules'), ...Module.globalPaths]
const packageDirectory = (name) => {
  for (const base of packageRoots) {
    const directory = path.join(base, ...name.split('/'))
    const filename = path.join(directory, 'package.json')
    if (existsSync(filename)) {
      return {directory, manifest: JSON.parse(readFileSync(filename, 'utf8'))}
    }
  }
  throw new Error(`Cannot locate package.json for ${name}`)
}

const packages = new Map()
const visit = (name) => {
  if (packages.has(name)) return
  const resolved = packageDirectory(name)
  packages.set(name, resolved)
  Object.keys(resolved.manifest.dependencies || {}).forEach(visit)
}
;['@vscode/markdown-editor', '@vscode/observables', 'katex'].forEach(visit)

const notices = ['Third-party licenses for the Preview Markdown editor bundle.']
for (const [name, {directory, manifest}] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  let license = ''
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try {
      license = await readFile(path.join(directory, filename), 'utf8')
      break
    }
    catch {}
  }
  const notice = (license || 'No standalone license file was published in this package.').replace(/[ \t]+$/gm, '')
  notices.push(`\n\n## ${name}@${manifest.version}\n\nLicense: ${manifest.license || 'see package'}\n\n${notice}`)
}
await writeFile(path.join(output, 'THIRD-PARTY-LICENSES.txt'), notices.join(''), 'utf8')
