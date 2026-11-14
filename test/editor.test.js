
const assert = require('node:assert/strict')
const {describe, it, beforeEach} = require('node:test')
const mdEditor = require('../content/editor.js')
const mdFileWriter = require('../content/file-writer.js')

beforeEach(() => {
  global.location = {protocol: 'file:', href: 'file:///F:/temp/document.md'}
})

const withUserActivation = async (isActive, callback) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: {userActivation: {isActive}}, configurable: true, writable: true,
  })
  try {
    await callback()
  }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
  }
}

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

describe('reading position mapping', () => {
  it('locates a visible paragraph and aligns headings to the source line', () => {
    const source = '# 标题\n\n第一段。\n\n第二段。\n'
    assert.equal(mdEditor.sourceOffset(source, '第二段。', 0.9), source.indexOf('第二段。'))
    assert.equal(mdEditor.sourceOffset(source, '标题', 0), 0)
  })

  it('uses reading progress to disambiguate repeated source text', () => {
    const source = `重复段落\n${'中'.repeat(100)}\n重复段落\n`
    const expected = source.lastIndexOf('重复段落')
    assert.equal(mdEditor.sourceOffset(source, '重复段落', 0.95), expected)
  })

  it('matches a useful visible prefix before falling back to progress', () => {
    const prefix = '这是一段很长的可见文本，用来确认行内标记之前的前缀仍然可以定位。'
    const source = `${prefix}${'后续文字'.repeat(20)}**加粗内容**\n下一段\n`
    assert.equal(mdEditor.sourceOffset(source, `${prefix}${'后续文字'.repeat(20)}加粗内容`, 0.9), 0)
  })

  it('falls back to a line near reading progress and clamps the document end', () => {
    const source = '第一行\n第二行\n第三行\n第四行\n'
    const offset = mdEditor.sourceOffset(source, '无法匹配的渲染文本', 0.5)
    assert.equal(source.slice(0, offset).endsWith('\n'), true)
    assert.equal(mdEditor.sourceOffset(source, '', 1), source.length)
    assert.equal(mdEditor.sourceOffset(source, '', 2), source.length)
  })

  it('maps zero-based source lines without losing CRLF boundaries', () => {
    const source = '# 标题\r\n\r\n第二段\r\n末尾'
    assert.equal(mdEditor.sourceLineOffset(source, 0), 0)
    assert.equal(mdEditor.sourceLineOffset(source, 2), source.indexOf('第二段'))
    assert.equal(mdEditor.sourceLineOffset(source, 3), source.indexOf('末尾'))
    assert.equal(mdEditor.sourceLineOffset(source, 99), source.length)
    assert.equal(mdEditor.sourceLineOffset(source, -2), 0)
    assert.equal(mdEditor.sourceLineOffset(source, Number.NaN), 0)
  })
})

describe('editor state', () => {
  it('prepares before reading on first entry even after an autoreload snapshot', async () => {
    const calls = []
    const editor = mdEditor.create({
      initial: '', filename: 'document.md',
      prepare: (request) => {
        calls.push('prepare')
        assert.equal(request.documentUrl, 'file:///F:/temp/document.md')
        assert.equal(request.expectedName, 'document.md')
        return Promise.resolve({status: 'ready'})
      },
      read: async () => {
        calls.push('read')
        return {text: '', bom: false, eol: '\n'}
      },
      canWrite: () => true,
      write: async () => ({status: 'written'}),
      preview: () => {}, replace: () => {}, confirm: () => true, onChange: () => {},
    })
    editor.observe({text: '', bom: false, eol: '\n'})
    await editor.enter()
    assert.deepEqual(calls, ['prepare', 'read'])
    assert.equal(editor.state.active, true)
    assert.equal(editor.state.status, '已连接当前文件并确认写入权限；之后保存不再选路径')
    editor.exit()
    await editor.enter()
    assert.deepEqual(calls, ['prepare', 'read'], '重新进入编辑器不重复准备或读盘')
  })

  it('keeps editing and allows save retry after prepare cancellation or failure', async () => {
    for (const prepare of [
      async () => ({status: 'cancelled'}),
      async () => { throw new Error('permission denied') },
    ]) {
      let writes = 0
      let prepareAttempts = 0
      const editor = mdEditor.create({
        initial: '', filename: 'document.md',
        prepare: async (...args) => {
          prepareAttempts++
          return prepareAttempts === 1 ? prepare(...args) : {status: 'ready'}
        },
        read: async () => ({text: '', bom: false, eol: '\n'}),
        write: async () => { writes++; return {status: 'written'} },
        canWrite: () => true,
        preview: () => {}, replace: () => {}, confirm: () => true, onChange: () => {},
      })
      await editor.enter()
      assert.equal(editor.state.active, true)
      assert.match(editor.state.status, /可在本页编辑/)
      editor.input('draft')
      await editor.save()
      assert.equal(writes, 1)
      assert.equal(editor.state.dirty, false)
    }
  })

  it('confirms write permission before every save-time disk read', async () => {
    const calls = []
    const editor = mdEditor.create({
      initial: '', filename: 'document.md',
      prepare: async () => { calls.push('prepare'); return {status: 'ready'} },
      read: async () => { calls.push('read'); return {text: '', bom: false, eol: '\n'} },
      write: async () => { calls.push('write'); return {status: 'written'} },
      canWrite: () => true,
      preview: () => {}, replace: () => {}, confirm: () => true, onChange: () => {},
    })
    await editor.enter()
    calls.length = 0
    editor.input('draft')
    await editor.save()
    assert.deepEqual(calls, ['prepare', 'read', 'write'])
  })

  it('stops before reading or writing when save-time preparation is cancelled', async () => {
    let reads = 0
    let writes = 0
    const editor = mdEditor.create({
      initial: '', filename: 'document.md',
      prepare: async () => ({status: 'cancelled'}),
      read: async () => { reads++; return {text: '', bom: false, eol: '\n'} },
      write: async () => { writes++; return {status: 'written'} },
      canWrite: () => true,
      preview: () => {}, replace: () => {}, confirm: () => true, onChange: () => {},
    })
    await editor.enter()
    editor.input('draft')
    const result = await editor.save()
    assert.equal(result.status, 'cancelled')
    assert.equal(reads, 1, '只有进入编辑时读取磁盘快照')
    assert.equal(writes, 0)
    assert.equal(editor.state.dirty, true)
    assert.match(editor.state.status, /草稿仍保留/)
  })

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

  it('does not attempt source writes when write-back is unsupported', async () => {
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

  it('keeps the draft and disk baseline after a write failure', async () => {
    const context = harness()
    await context.editor.enter()
    context.editor.input('draft\n')
    const baseline = context.disk
    context.writeHook = async () => { throw new Error('NotAllowedError') }
    const result = await context.editor.save()
    assert.equal(result.status, 'failed')
    assert.equal(context.disk, baseline)
    assert.equal(context.editor.state.draft, 'draft\n')
    assert.equal(context.editor.state.dirty, true)
    assert.match(context.editor.state.status, /保存失败/)
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

  it('uses an already granted handle without requesting permission or activation', async () => {
    await withUserActivation(false, async () => {
      let requests = 0
      const handle = {
        queryPermission: async (options) => {
          assert.deepEqual(options, {mode: 'readwrite'})
          return 'granted'
        },
        requestPermission: async () => { requests++; return 'granted' },
      }
      await mdFileWriter.ensureWritable(handle)
      assert.equal(requests, 0)
    })
  })

  it('requests readwrite permission for a prompt handle during user activation', async () => {
    await withUserActivation(true, async () => {
      const calls = []
      const handle = {
        queryPermission: async () => { calls.push('query'); return 'prompt' },
        requestPermission: async (options) => {
          calls.push('request')
          assert.deepEqual(options, {mode: 'readwrite'})
          return 'granted'
        },
      }
      await mdFileWriter.ensureWritable(handle)
      assert.deepEqual(calls, ['query', 'request'])
    })
  })

  it('does not request or write a denied handle', async () => {
    let requests = 0
    const handle = {
      queryPermission: async () => 'denied',
      requestPermission: async () => { requests++; return 'denied' },
    }
    await assert.rejects(mdFileWriter.ensureWritable(handle), /写入权限已被拒绝/)
    assert.equal(requests, 0)
  })

  it('requires a fresh user operation before requesting permission', async () => {
    await withUserActivation(false, async () => {
      let requests = 0
      const handle = {
        queryPermission: async () => 'prompt',
        requestPermission: async () => { requests++; return 'granted' },
      }
      await assert.rejects(mdFileWriter.ensureWritable(handle), /必须由点击或键盘操作触发/)
      assert.equal(requests, 0)
    })
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
