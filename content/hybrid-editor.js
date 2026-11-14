
var mdHybrid = (() => {
  var lib = globalThis.mdHybridLibrary

  var create = (options) => {
    var applyingContent = false
    var model = new lib.EditorModel()
    model.sourceText.set(new lib.StringValue(options.content || ''), undefined)
    model.readonlyMode.set(true, undefined)
    model.presentation.set('editing', undefined)

    var customLanguages = new Set(options.customCodeLanguages || [])
    var customSourceOffsets = () => {
      var offsets = []
      var active = model.activeBlocks.get()
      var visit = (nodes, base) => {
        var offset = base
        nodes.forEach((node) => {
          var language = node instanceof lib.CodeBlockAstNode
            ? node.language.trim().split(/\s+/)[0].toLowerCase()
            : ''
          if (node instanceof lib.CodeBlockAstNode && !active.has(node) && customLanguages.has(language)) {
            offsets.push(offset + node.codeOffset)
          }
          visit(node.children, offset)
          offset += node.length
        })
      }
      visit(model.document.get().children, 0)
      return offsets
    }

    var limitedWidth = lib.observableValue('markdownViewerLimitedWidth', undefined)
    var active = false
    var pendingCustomCode = []
    var customCodeFrame
    var renderPendingCustomCode = () => {
      customCodeFrame = undefined
      if (!active) return
      var pending = pendingCustomCode
      pendingCustomCode = []
      pending.forEach((block) => {
        if (!block.placeholder.isConnected) return
        if (!block.placeholder.clientWidth) {
          pendingCustomCode.push(block)
          return
        }
        options.renderCodeBlock(block.language, block.content, block.placeholder)
      })
      if (pendingCustomCode.length) customCodeFrame = requestAnimationFrame(renderPendingCustomCode)
    }
    var scheduleCustomCode = () => {
      if (active && customCodeFrame === undefined) {
        customCodeFrame = requestAnimationFrame(renderPendingCustomCode)
      }
    }
    var view = new lib.EditorView(model, {
      classNames: ['github-markdown-theme', 'md-viewer-hybrid'],
      presentation: 'editing',
      limitedWidth,
      showReadonlyToggle: false,
      highlightActiveBlock: true,
      onToggleCheckbox: (item, checked) => model.setTaskCheckboxChecked(item, checked),
      onOpenLink: (url) => {
        if (/^https?:/i.test(url)) {
          window.open(url, '_blank', 'noopener,noreferrer')
          return
        }
        window.location.assign(new URL(url, window.location.href).href)
      },
      renderCustomCodeBlock: (language, content) => {
        var normalized = language.trim().split(/\s+/)[0].toLowerCase()
        if (!customLanguages.has(normalized) || !options.renderCodeBlock) return undefined
        var placeholder = document.createElement('div')
        placeholder.className = '_hybrid-custom-code'
        placeholder.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          var placeholders = Array.from(view.element.querySelectorAll('._hybrid-custom-code'))
          var offset = customSourceOffsets()[placeholders.indexOf(placeholder)]
          if (offset === undefined) return
          event.preventDefault()
          event.stopPropagation()
          view.focus()
          model.selection.set(lib.Selection.collapsed(offset), undefined)
        })
        pendingCustomCode.push({placeholder, language: normalized, content})
        scheduleCustomCode()
        return placeholder
      },
    })
    view.element.id = '_hybrid-editor-input'
    view.element.setAttribute('role', 'textbox')
    view.element.setAttribute('aria-multiline', 'true')
    view.element.setAttribute('aria-label', 'Markdown Preview 编辑器')

    var history = new lib.LocalHistoryStrategy(model)
    var controller = new lib.EditorController(model, view, {historyStrategy: history})
    var revealVersion = 0
    var revealFrame
    var pendingReveal
    var interruptEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown']
    var removeInterruptListeners = () => {
      interruptEvents.forEach((name) => document.removeEventListener(name, interruptReveal, true))
    }
    var cancelReveal = () => {
      revealVersion += 1
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
      revealFrame = undefined
      if (pendingReveal) pendingReveal.dispose()
      pendingReveal = undefined
      removeInterruptListeners()
    }
    function interruptReveal () {
      cancelReveal()
    }

    var previous = options.content || ''
    var observer = lib.autorun((reader) => {
      var content = reader.readObservable(model.sourceText).value
      if (!applyingContent && content !== previous) options.onInput(content)
      previous = content
    })
    // The persistent host owns these listeners for the lifetime of the page.
    void controller
    void observer

    return {
      element: view.element,
      getContent: () => model.sourceText.get().value,
      setContent: (content) => {
        cancelReveal()
        if (model.sourceText.get().value === content) return
        applyingContent = true
        try {
          model.replaceSourceText(new lib.StringValue(content))
          previous = content
        }
        finally {
          applyingContent = false
        }
      },
      setActive: (value) => {
        cancelReveal()
        active = value
        if (!active && customCodeFrame !== undefined) {
          cancelAnimationFrame(customCodeFrame)
          customCodeFrame = undefined
        }
        model.readonlyMode.set(!value, undefined)
        if (!value) model.selection.set(undefined, undefined)
        scheduleCustomCode()
      },
      focus: () => view.focus(),
      revealSourceLine: (line) => {
        if (!active || !Number.isFinite(line)) return
        cancelReveal()
        var version = revealVersion
        var source = model.sourceText.get()
        var offset = mdEditor.sourceLineOffset(source.value, line)
        var selection = lib.Selection.collapsed(offset)
        var range = lib.OffsetRange.emptyAt(offset)
        model.selection.set(selection, undefined)
        interruptEvents.forEach((name) => {
          document.addEventListener(name, interruptReveal, {capture: true, passive: true})
        })
        var attempts = 60
        var reveal = () => {
          if (version !== revealVersion || !active) return
          if (model.sourceText.get() !== source || model.selection.get() !== selection) {
            cancelReveal()
            return
          }
          if (pendingReveal) pendingReveal.dispose()
          pendingReveal = view.revealRangeAtTop(range, 'instant')
          if (--attempts > 0) revealFrame = requestAnimationFrame(reveal)
          else {
            revealFrame = undefined
            removeInterruptListeners()
          }
        }
        revealFrame = requestAnimationFrame(reveal)
      },
    }
  }

  return {create}
})()
