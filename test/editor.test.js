
const assert = require('node:assert/strict')
const {describe, it, beforeEach} = require('node:test')
const mdEditor = require('../content/editor.js')
const mdFileWriter = require('../content/file-writer.js')

beforeEach(() => {
  global.location = {protocol: 'file:', href: 'file:///F:/temp/document.md'}
})

const harness = (initial = '# Title\r\n\r\nText\r\n', bom = true) => {
  let disk = initial
  let format = {bom, eol: initial.includes('\r\n') ? '\r\n' : '\n'}
  const writes = []
  const previews = []
  let writeHook
  const editor = mdEditor.create({
    initial: initial.replace(/\r\n?/g, '\n'),
    filename: 'document.md',
    read: async () => ({text: disk, ...format}),
    write: async (request) => {
      writes.push(request.content)
      if (writeHook) await writeHook(request)
      disk = request.content.replace(/^﻿/, '')
      return {status: 'written'}
    },
    preview: (md) => previews.push(md),
    replace: () => {},
    confirm: () => true,
    onChange: () => {},
  })
  return {
    editor,
    writes,
    previews,
    get disk() { return disk },
    set disk(value) { disk = value },
    set format(value) { format = value },
    set writeHook(value) { writeHook = value },
  }
}

describe('source format and render sequence', () => {
  it('round-trips UTF-8 BOM, CRLF and trailing newlines', () => {
    const source = '﻿# 标题\r\n\r\n中文\r\n'
    const normalized = mdEditor.normalize(source.replace(/^﻿/, ''))
    assert.equal(normalized, '# 标题\n\n中文\n')
    assert.equal(mdEditor.serialize(normalized, {bom: true, eol: '\r\n'}), source)
  })

  it('ignores responses that are not the latest render', () => {
    const latest = mdEditor.latest()
    const first = latest.next()
    const second = latest.next()
    assert.equal(latest.isCurrent(first), false)
    assert.equal(latest.isCurrent(second), true)
  })
})

describe('editor state', () => {
  it('saves exact source and clears dirty only after a successful write', async () => {
    const context = harness()
    await context.editor.enter()
    assert.equal(context.editor.state.draft, '# Title\n\nText\n')
    context.editor.input('# Changed\n')
    await context.editor.save()
    assert.deepEqual(context.writes, ['﻿# Changed\r\n'])
    assert.equal(context.editor.state.dirty, false)
    assert.equal(context.editor.state.status, '已保存原文件')
  })

  it('keeps newer input dirty when it arrives during a save', async () => {
    const context = harness()
    await context.editor.enter()
    context.editor.input('first\n')
    let release
    let started
    const waiting = new Promise((resolve) => { started = resolve })
    context.writeHook = () => {
      started()
      return new Promise((resolve) => { release = resolve })
    }
    const saving = context.editor.save()
    await waiting
    context.editor.input('second\n')
    release()
    await saving
    assert.equal(context.disk, 'first\r\n')
    assert.equal(context.editor.state.draft, 'second\n')
    assert.equal(context.editor.state.dirty, true)
    context.writeHook = null
    await context.editor.save()
    assert.equal(context.editor.state.dirty, false)
    assert.equal(context.disk, 'second\r\n')
  })

  it('blocks an external overwrite and requires explicit force', async () => {
    const context = harness()
    await context.editor.enter()
    context.editor.input('draft\n')
    context.disk = 'external\r\n'
    const result = await context.editor.save()
    assert.equal(result.status, 'conflict')
    assert.equal(context.writes.length, 0)
    assert.equal(context.editor.state.draft, 'draft\n')
    await context.editor.save(true)
    assert.equal(context.writes.length, 1)
    assert.equal(context.disk, 'draft\r\n')
  })

  it('never overwrites a dirty draft through autoreload', async () => {
    const context = harness()
    await context.editor.enter()
    context.editor.input('draft\n')
    const result = context.editor.observe({text: 'external\r\n', bom: true, eol: '\r\n'})
    assert.equal(result, 'conflict')
    assert.equal(context.editor.state.draft, 'draft\n')
    context.editor.keepDraft()
    assert.equal(context.editor.observe({text: 'external\r\n', bom: true, eol: '\r\n'}), 'conflict')
    assert.equal(context.editor.state.external, null)
    assert.equal(context.editor.state.status, '已保留草稿；保存前会再次核对磁盘文件')
    context.editor.observe({text: 'external 2\r\n', bom: true, eol: '\r\n'})
    assert.equal(context.editor.state.external.text, 'external 2\r\n')
    context.editor.loadExternal()
    assert.equal(context.editor.state.draft, 'external 2\n')
    assert.equal(context.editor.state.dirty, false)
  })

  it('treats a BOM-only disk change as a conflict', async () => {
    const context = harness()
    await context.editor.enter()
    context.editor.input('draft\n')
    context.format = {bom: false, eol: '\r\n'}
    const result = await context.editor.save()
    assert.equal(result.status, 'conflict')
    assert.equal(context.writes.length, 0)
    assert.equal(context.editor.state.draft, 'draft\n')
  })

  it('does not attempt source writes when only export is available', async () => {
    let reads = 0
    let writes = 0
    const editor = mdEditor.create({
      initial: '', filename: 'document.md',
      read: async () => { reads++; return {text: '', bom: false, eol: '\n'} },
      write: async () => { writes++; return {status: 'written'} },
      canWrite: () => false,
      preview: () => {}, replace: () => {}, confirm: () => true, onChange: () => {},
    })
    await editor.enter()
    editor.input('draft')
    const result = await editor.save()
    assert.equal(result.status, 'unsupported')
    assert.equal(reads, 1)
    assert.equal(writes, 0)
    assert.equal(editor.state.dirty, true)
  })

  it('keeps a draft after picker cancellation and write failure', async () => {
    const editor = mdEditor.create({
      initial: '', filename: 'document.md', read: async () => ({text: '', bom: false, eol: '\n'}),
      write: async () => ({status: 'cancelled'}), preview: () => {}, replace: () => {},
      confirm: () => true, onChange: () => {},
    })
    await editor.enter()
    editor.input('draft')
    await editor.save()
    assert.equal(editor.state.dirty, true)
    assert.match(editor.state.status, /已取消/)
  })

  it('warns before unloading a dirty or saving editor', async () => {
    const context = harness()
    await context.editor.enter()
    const cleanEvent = {preventDefault() { throw new Error('must not prevent') }}
    context.editor.beforeUnload(cleanEvent)
    context.editor.input('dirty')
    const event = {prevented: false, preventDefault() { this.prevented = true }}
    context.editor.beforeUnload(event)
    assert.equal(event.prevented, true)
    assert.equal(event.returnValue, '')
  })
})

describe('file handle writes', () => {
  it('commits exact content through createWritable', async () => {
    const writes = []
    const handle = {
      queryPermission: async () => 'granted',
      createWritable: async () => ({
        write: async (content) => writes.push(content),
        close: async () => writes.push('closed'),
      }),
    }
    await mdFileWriter.writeHandle(handle, '﻿content\r\n')
    assert.deepEqual(writes, ['﻿content\r\n', 'closed'])
  })

  it('aborts instead of committing a partial write', async () => {
    let aborted = false
    let closed = false
    const handle = {
      queryPermission: async () => 'granted',
      createWritable: async () => ({
        write: async () => { throw new Error('disk full') },
        close: async () => { closed = true },
        abort: async () => { aborted = true },
      }),
    }
    await assert.rejects(mdFileWriter.writeHandle(handle, 'draft'), /disk full/)
    assert.equal(aborted, true)
    assert.equal(closed, false)
  })

  it('delegates restored-handle permission to createWritable', async () => {
    let created = false
    const handle = {
      createWritable: async () => {
        created = true
        return {write: async () => {}, close: async () => {}}
      },
    }
    await mdFileWriter.writeHandle(handle, 'draft')
    assert.equal(created, true)
  })

  it('only exposes write-back when the MAIN-world writer is ready', () => {
    global.document = {documentElement: {dataset: {mdFileWriter: 'ready'}}}
    try {
      assert.equal(mdFileWriter.canWrite(), true)
      delete global.document.documentElement.dataset.mdFileWriter
      assert.equal(mdFileWriter.canWrite(), false)
    }
    finally {
      delete global.document
    }
  })
})
