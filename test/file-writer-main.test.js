
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {describe, it} = require('node:test')

const loadWriter = ({restored = null, opened = null, active = true, calls = []} = {}) => {
  const listeners = new Map()
  let pending = null
  let pickers = 0

  const database = {
    transaction: (store, mode) => {
      if (mode === 'readonly') {
        return {
          objectStore: () => ({
            get: () => {
              const request = {}
              queueMicrotask(() => {
                request.result = restored
                request.onsuccess()
              })
              return request
            },
          }),
        }
      }
      const transaction = {
        objectStore: () => ({
          put: () => { calls.push('persist') },
        }),
      }
      queueMicrotask(() => transaction.oncomplete())
      return transaction
    },
  }

  const document = {
    documentElement: {dataset: {}},
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent: (event) => {
      if (event.type === 'md:source-file-save-response') {
        const resolve = pending
        pending = null
        resolve(event.detail)
      }
      else {
        listeners.get(event.type)(event)
      }
    },
  }

  const context = vm.createContext({
    console,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type
        this.detail = options.detail
      }
    },
    document,
    indexedDB: {
      open: () => {
        const request = {}
        queueMicrotask(() => {
          request.result = database
          request.onsuccess()
        })
        return request
      },
    },
    location: {protocol: 'file:', href: 'file:///F:/temp/document.md'},
    navigator: {userActivation: {isActive: active}},
    module: {exports: {}},
  })
  context.window = context
  context.showOpenFilePicker = async () => {
    pickers++
    calls.push('picker')
    return [opened]
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/file-writer.js'), 'utf8'), context)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/file-writer-main.js'), 'utf8'), context)

  const send = (request) => new Promise((resolve) => {
    pending = resolve
    document.dispatchEvent(new context.CustomEvent('md:source-file-save-request', {
      detail: {
        requestId: 'test-request',
        documentUrl: context.location.href,
        expectedName: 'document.md',
        ...request,
      },
    }))
  })
  return {calls, context, send, get pickers() { return pickers }}
}

const handle = (calls, initialPermission = 'prompt') => {
  let permission = initialPermission
  return {
    name: 'document.md',
    queryPermission: async () => { calls.push('query'); return permission },
    requestPermission: async () => {
      calls.push('request')
      permission = 'granted'
      return permission
    },
    getFile: async () => {
      calls.push('getFile')
      return {text: async () => { calls.push('text'); return 'disk' }}
    },
    createWritable: async () => {
      calls.push('create')
      return {
        write: async () => { calls.push('write') },
        close: async () => { calls.push('close') },
      }
    },
  }
}

describe('MAIN-world file writer permission flow', () => {
  it('authorizes a restored handle during prepare and writes when already granted', async () => {
    const calls = []
    const writer = loadWriter({restored: handle(calls), calls})
    assert.equal((await writer.send({prepare: true})).status, 'ready')
    assert.deepEqual(calls, ['query', 'request'])
    assert.equal(writer.pickers, 0)

    writer.context.navigator.userActivation.isActive = false
    const result = await writer.send({prepare: false, expectedText: 'disk', content: 'draft'})
    assert.equal(result.status, 'written')
    assert.deepEqual(calls, ['query', 'request', 'create', 'write', 'close'])
  })

  it('requests permission before first-write text verification and persistence', async () => {
    const calls = []
    const writer = loadWriter({opened: handle(calls), calls})
    assert.equal((await writer.send({prepare: true})).status, 'ready')
    const result = await writer.send({prepare: false, expectedText: 'disk', content: 'draft'})
    assert.equal(result.status, 'written')
    assert.deepEqual(calls, [
      'picker', 'query', 'request', 'getFile', 'text', 'persist', 'create', 'write', 'close',
    ])
  })

  it('rejects a denied restored handle without opening a picker or writing', async () => {
    const calls = []
    const writer = loadWriter({restored: handle(calls, 'denied'), calls})
    const result = await writer.send({prepare: true})
    assert.equal(result.status, 'failed')
    assert.match(result.error, /写入权限已被拒绝/)
    assert.equal(writer.pickers, 0)
    assert.deepEqual(calls, ['query'])
  })

  it('requires user activation before opening a new picker', async () => {
    const writer = loadWriter({opened: handle([]), active: false})
    const result = await writer.send({prepare: true})
    assert.equal(result.status, 'failed')
    assert.match(result.error, /必须由点击或键盘操作触发/)
    assert.equal(writer.pickers, 0)
  })
})
