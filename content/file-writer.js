
var mdFileWriter = (() => {
  var REQUEST = 'md:source-file-save-request'
  var RESPONSE = 'md:source-file-save-response'

  var pickerOptions = () => ({
    id: 'simov-markdown-viewer-editor',
    multiple: false,
    types: [{
      description: 'Markdown',
      accept: {'text/markdown': ['.md', '.markdown', '.mdown', '.mkd']},
    }],
  })

  var writeHandle = async (handle, content) => {
    var writable = await handle.createWritable()
    try {
      await writable.write(content)
      await writable.close()
    }
    catch (err) {
      await writable.abort().catch(() => undefined)
      throw err
    }
  }

  var canWrite = () => location.protocol === 'file:' &&
    document.documentElement.dataset.mdFileWriter === 'ready'

  var send = (request, prepare) => new Promise((resolve, reject) => {
    if (location.protocol !== 'file:') {
      reject(new Error('只有本地 file:// 文档支持覆盖原文件'))
      return
    }
    if (!canWrite()) {
      reject(new Error('本地写回组件不可用，请刷新页面后重试；未下载副本'))
      return
    }

    var requestId = `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`
    var response = (event) => {
      var detail = event.detail
      if (!detail || detail.requestId !== requestId) return
      document.removeEventListener(RESPONSE, response)
      if (detail.status === 'written' || detail.status === 'ready' || detail.status === 'cancelled') {
        resolve({status: detail.status})
      }
      else {
        reject(new Error(detail.error || (prepare ? '无法连接本地 Markdown 文件' : '无法写入本地 Markdown 文件')))
      }
    }
    document.addEventListener(RESPONSE, response)
    document.dispatchEvent(new CustomEvent(REQUEST, {
      detail: Object.assign({}, request, {requestId, prepare}),
    }))
  })

  var prepare = (request) => send(request, true)
  var save = (request) => send(request, false)

  return {REQUEST, RESPONSE, pickerOptions, canWrite, writeHandle, prepare, save}
})()

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mdFileWriter
}
