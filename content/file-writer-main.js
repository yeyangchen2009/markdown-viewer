
;(() => {
  if (document.documentElement.dataset.mdFileWriter === 'ready') return

  var DATABASE = 'simov-markdown-viewer-editor'
  var STORE = 'file-handles'
  var databasePromise = null
  var handles = new Map()

  var openDatabase = () => {
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      var request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('文件句柄数据库被占用'))
    })
    databasePromise.catch(() => {
      databasePromise = null
    })
    return databasePromise
  }

  var restore = async (key) => {
    var database = await openDatabase()
    return new Promise((resolve, reject) => {
      var request = database.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  var persist = async (key, handle) => {
    var database = await openDatabase()
    return new Promise((resolve, reject) => {
      var transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(handle, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  }

  var respond = (requestId, status, error) => {
    document.dispatchEvent(new CustomEvent(mdFileWriter.RESPONSE, {
      detail: {requestId, status, ...(error ? {error} : {})},
    }))
  }

  var acquire = async (request) => {
    var key = request.documentUrl
    var entry = handles.get(key)
    if (!entry) {
      var restored = await restore(key).catch(() => null)
      if (restored) entry = {handle: restored, verified: true}
    }
    if (!entry) {
      mdFileWriter.requireActivation('选择文件')
      var handle = (await window.showOpenFilePicker(mdFileWriter.pickerOptions()))[0]
      if (!handle) throw new Error('没有选择文件')
      entry = {handle, verified: false}
    }
    if (entry.handle.name !== request.expectedName) {
      throw new Error(`请选择当前打开的 ${request.expectedName}`)
    }
    handles.set(key, entry)
    return entry
  }

  document.addEventListener(mdFileWriter.REQUEST, async (event) => {
    var request = event.detail
    if (!request || typeof request.requestId !== 'string') return

    try {
      if (location.protocol !== 'file:' || request.documentUrl !== location.href.replace(/#.*$/, '')) {
        throw new Error('写回请求与当前本地文档不匹配')
      }
      if (typeof request.expectedName !== 'string' || (!request.prepare &&
          (typeof request.content !== 'string' || typeof request.expectedText !== 'string'))) {
        throw new Error('写回请求格式无效')
      }
      if (!window.showOpenFilePicker) {
        throw new Error('当前浏览器不支持本地文件写回')
      }

      var key = request.documentUrl
      var entry = await acquire(request)
      if (request.prepare) {
        await mdFileWriter.ensureWritable(entry.handle)
        respond(request.requestId, 'ready')
        return
      }
      if (!entry.verified) {
        if (await entry.handle.getFile().then((file) => file.text()) !== request.expectedText) {
          handles.delete(key)
          throw new Error('所选文件与当前磁盘内容不一致，请重新核对后再保存')
        }
        entry.verified = true
        await persist(key, entry.handle).catch((err) => {
          console.warn('[Markdown Viewer] 文件句柄无法持久化：', err)
        })
      }

      await mdFileWriter.writeHandle(entry.handle, request.content)
      respond(request.requestId, 'written')
    }
    catch (err) {
      if (err && err.name === 'AbortError') {
        respond(request.requestId, 'cancelled')
      }
      else {
        respond(request.requestId, 'failed', err && err.message ? err.message : String(err))
      }
    }
  })

  document.documentElement.dataset.mdFileWriter = 'ready'
})()
