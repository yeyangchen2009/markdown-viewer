
const assert = require('node:assert/strict')
const {describe, it} = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

const loadXhr = (bytes) => {
  const source = fs.readFileSync(require.resolve('../background/xhr.js'), 'utf8')
  const context = {
    md: {},
    Date,
    TextDecoder,
    Uint8Array,
    fetch: async () => ({ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}),
  }
  vm.runInNewContext(source, context)
  return context.md.xhr()
}

const snapshot = (xhr) => new Promise((resolve, reject) => {
  xhr.snapshot('file:///document.md', (err, value) => err ? reject(err) : resolve(value))
})

describe('background source snapshots', () => {
  it('preserves CRLF and records a UTF-8 BOM without including it in text', async () => {
    const xhr = loadXhr(Buffer.from('﻿# Title\r\n\r\nText\r\n', 'utf8'))
    const value = await snapshot(xhr)
    assert.equal(value.text, '# Title\r\n\r\nText\r\n')
    assert.equal(value.bom, true)
    assert.equal(value.eol, '\r\n')
  })

  it('preserves LF and an empty file', async () => {
    const xhr = loadXhr(Buffer.from('# Title\n', 'utf8'))
    assert.deepEqual({...await snapshot(xhr)}, {text: '# Title\n', bom: false, eol: '\n'})
    const empty = loadXhr(Buffer.alloc(0))
    assert.deepEqual({...await snapshot(empty)}, {text: '', bom: false, eol: '\n'})
  })
})
