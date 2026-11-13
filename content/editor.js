
var mdEditor = (() => {
  var normalize = (text) => text.replace(/\r\n?/g, '\n')

  var serialize = (text, format, bom = true) =>
    (bom && format.bom ? '﻿' : '') +
    normalize(text).replace(/\n/g, format.eol)

  var latest = () => {
    var value = 0
    return {
      next: () => ++value,
      isCurrent: (token) => token === value,
    }
  }

  var create = (options) => {
    var state = {
      active: false,
      entered: false,
      initialized: false,
      busy: false,
      saving: false,
      dirty: false,
      draft: normalize(options.initial || ''),
      disk: null,
      format: {bom: false, eol: '\n'},
      revision: 0,
      external: null,
      dismissed: null,
      status: '',
    }

    var notify = () => options.onChange(state)

    var apply = (snapshot) => {
      state.disk = snapshot.text
      state.format = {bom: snapshot.bom, eol: snapshot.eol}
      state.draft = normalize(snapshot.text)
      state.revision++
      state.dirty = false
      state.external = null
      state.dismissed = null
      state.initialized = true
    }

    var matchesDisk = (snapshot) => snapshot.text === state.disk &&
      snapshot.bom === state.format.bom && snapshot.eol === state.format.eol

    var enter = async () => {
      if (state.active || state.busy) return
      if (state.entered) {
        state.active = true
        notify()
        return
      }
      state.busy = true
      var writable = options.canWrite ? options.canWrite() : location.protocol === 'file:'
      var preparation
      try {
        preparation = writable && options.prepare
          ? options.prepare({
            documentUrl: location.href.replace(/#.*$/, ''),
            expectedName: options.filename,
          })
          : Promise.resolve({status: writable ? 'ready' : 'unsupported'})
      }
      catch (err) {
        preparation = Promise.resolve({status: 'failed', error: err.message || String(err)})
      }
      preparation = preparation.catch((err) => ({status: 'failed', error: err.message || String(err)}))
      state.status = '正在读取源文件…'
      notify()
      try {
        var snapshot = await options.read()
        var prepared = await preparation
        apply(snapshot)
        state.active = true
        state.entered = true
        state.status = prepared.status === 'ready'
          ? '已选择当前文件；之后保存不再选路径'
          : (prepared.status === 'cancelled'
            ? '未连接原文件；可编辑和导出，保存时可重新选择'
            : (prepared.status === 'failed'
              ? `原文件连接失败：${prepared.error}；可编辑和导出`
              : '当前文档只能导出副本，不能覆盖原文件'))
      }
      catch (err) {
        state.status = `读取失败：${err.message || err}`
      }
      finally {
        state.busy = false
        notify()
      }
    }

    var exit = () => {
      if (!state.active) return
      state.active = false
      options.preview(state.draft)
      notify()
    }

    var input = (value) => {
      state.draft = normalize(value)
      state.revision++
      state.dirty = true
      if (!state.external) state.status = '未保存'
    }

    var observe = (snapshot) => {
      if (state.initialized && matchesDisk(snapshot)) {
        return 'unchanged'
      }
      if (state.active || state.dirty) {
        if (state.dismissed === snapshot.text) return 'conflict'
        state.external = snapshot
        state.status = '磁盘文件已变化，草稿未被覆盖'
        notify()
        return 'conflict'
      }
      apply(snapshot)
      options.preview(state.draft)
      notify()
      return 'updated'
    }

    var loadExternal = () => {
      if (!state.external) return
      if (state.dirty && !options.confirm('载入磁盘版本将放弃当前未保存草稿，是否继续？')) {
        return
      }
      apply(state.external)
      state.status = '已载入磁盘版本'
      options.replace(state.draft)
      if (!state.active) options.preview(state.draft)
      notify()
    }

    var keepDraft = () => {
      state.dismissed = state.external && state.external.text
      state.external = null
      state.status = '已保留草稿；保存前会再次核对磁盘文件'
      notify()
    }

    var save = async (force = false) => {
      if (state.saving || state.busy || !state.initialized) return
      if (options.canWrite && !options.canWrite()) {
        state.status = '当前文档只能导出副本，不能覆盖原文件'
        notify()
        return {status: 'unsupported'}
      }
      if (!state.dirty && !force) {
        state.status = '没有未保存修改'
        notify()
        return
      }

      var revision = state.revision
      var draft = state.draft
      var format = Object.assign({}, state.format)
      state.saving = true
      state.status = '正在核对磁盘文件…'
      notify()

      try {
        var current = await options.read()
        if (!force && !matchesDisk(current)) {
          state.external = current
          state.dismissed = null
          state.status = '保存已停止：磁盘文件已被外部修改'
          return {status: 'conflict'}
        }

        state.status = '正在保存…'
        notify()
        var result = await options.write({
          documentUrl: location.href.replace(/#.*$/, ''),
          filename: options.filename,
          expectedName: options.filename,
          expectedText: current.text,
          content: serialize(draft, format),
        })

        if (result.status === 'cancelled') {
          state.status = '已取消保存，草稿仍保留'
          return result
        }

        state.disk = serialize(draft, format, false)
        state.format = format
        state.dirty = state.revision !== revision
        state.external = null
        state.dismissed = null
        state.status = state.dirty
          ? '已保存之前的快照；后续输入尚未保存'
          : '已保存原文件'
        return result
      }
      catch (err) {
        state.status = `保存失败：${err.message || err}`
        return {status: 'failed'}
      }
      finally {
        state.saving = false
        notify()
      }
    }

    var exportCopy = () => {
      var blob = new Blob([serialize(state.draft, state.format)], {type: 'text/markdown;charset=utf-8'})
      var url = URL.createObjectURL(blob)
      var link = document.createElement('a')
      link.href = url
      link.download = options.filename || 'markdown.md'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      state.status = '已导出副本；原文件未修改'
      notify()
    }

    var beforeUnload = (event) => {
      if (!state.dirty && !state.saving) return
      event.preventDefault()
      event.returnValue = ''
    }

    return {
      state,
      enter,
      exit,
      input,
      observe,
      loadExternal,
      keepDraft,
      save,
      exportCopy,
      beforeUnload,
    }
  }

  return {create, latest, normalize, serialize}
})()

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mdEditor
}
