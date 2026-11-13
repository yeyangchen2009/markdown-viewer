
var $ = document.querySelector.bind(document)

var state = {
  theme: args.theme,
  raw: args.raw,
  themes: args.themes,
  content: args.content,
  compiler: args.compiler,
  custom: args.custom,
  icon: args.icon,
  html: '',
  markdown: '',
  toc: '',
  preserveScroll: null,
  editorScroll: 0,
  reload: {
    interval: null,
    ms: 1000,
    md: false,
  },
  _themes: {
    'github': 'light',
    'github-dark': 'dark',
    'almond': 'light',
    // 'air': 'light',
    'awsm': 'light',
    'axist': 'light',
    'bamboo': 'auto',
    'bullframe': 'light',
    'holiday': 'auto',
    'kacit': 'light',
    'latex': 'light',
    'marx': 'light',
    'mini': 'light',
    'modest': 'light',
    'new': 'auto',
    'no-class': 'auto',
    'pico': 'auto',
    'retro': 'dark',
    'sakura': 'light',
    'sakura-vader': 'dark',
    'semantic': 'light',
    'simple': 'auto',
    // 'splendor': 'light',
    'style-sans': 'light',
    'style-serif': 'light',
    'stylize': 'light',
    'superstylin': 'auto',
    'tacit': 'light',
    'vanilla': 'auto',
    'water': 'light',
    'water-dark': 'dark',
    'writ': 'light',
    'custom': 'auto',
  }
}

var readSource = () => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({
    message: 'source.snapshot',
    location: location.href.replace(/#.*$/, ''),
  }, (res) => {
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message))
    }
    else if (!res || res.err || !res.snapshot) {
      reject(new Error(res && res.err ? res.err : '没有取得源文件快照'))
    }
    else {
      resolve(res.snapshot)
    }
  })
})

var editor = mdEditor.create({
  initial: $('pre') ? $('pre').innerText : '',
  filename: decodeURIComponent(location.pathname.split('/').pop() || 'markdown.md'),
  read: readSource,
  write: mdFileWriter.save,
  canWrite: mdFileWriter.canWrite,
  preview: (md) => render(md),
  replace: (md) => {
    var textarea = $('#_editor-input')
    if (textarea) textarea.value = md
  },
  confirm: (message) => window.confirm(message),
  onChange: () => m.redraw(),
})

window.addEventListener('beforeunload', editor.beforeUnload)

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editor.state.active) {
    event.preventDefault()
    if (!event.repeat) editor.save()
  }
})

var toggleEditor = async () => {
  if (editor.state.active) {
    state.preserveScroll = state.editorScroll
    editor.exit()
    return
  }
  state.editorScroll = window.scrollY
  await editor.enter()
  if (editor.state.active) {
    requestAnimationFrame(() => {
      var textarea = $('#_editor-input')
      if (textarea) textarea.focus()
    })
  }
}

var saveEditor = (force) => {
  if (force && !window.confirm('磁盘文件已被外部修改。仍要用当前草稿覆盖它吗？')) return
  editor.save(force)
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.message === 'reload') {
    location.reload(true)
  }
  else if (req.message === 'theme') {
    state.theme = req.theme
    m.redraw()
  }
  else if (req.message === 'themes') {
    state.themes = req.themes
    m.redraw()
  }
  else if (req.message === 'raw') {
    state.raw = req.raw
    state.reload.md = true
    m.redraw()
  }
  else if (req.message === 'autoreload') {
    clearInterval(state.reload.interval)
  }
})

var oncreate = {
  html: () => {
    update()
  },
  editor: (vnode) => {
    vnode.dom.value = editor.state.draft
  },
}

var onupdate = {
  html: () => {
    if (state.reload.md) {
      state.reload.md = false
      update(true)
    }
  },
  theme: () => {
    if (state.content.mermaid) {
      setTimeout(() => mmd.render(), 0)
    }
  }
}

var update = (update) => {
  if (state.preserveScroll !== null) {
    var offset = state.preserveScroll
    state.preserveScroll = null
    if ($('#_html')) $('#_html').style.visibility = 'visible'
    if ($('#_toc') && !state.raw) $('#_toc').style.visibility = 'visible'
    requestAnimationFrame(() => window.scrollTo(0, offset))
  }
  else {
    scroll(update)
  }

  if (state.content.syntax) {
    setTimeout(() => Prism.highlightAll(), 20)
  }

  if (state.content.mermaid) {
    setTimeout(() => mmd.render(), 40)
  }

  if (state.content.mathjax) {
    setTimeout(() => mj.render(), 60)
  }
}

var renderSequence = mdEditor.latest()
var render = (md) => {
  var sequence = renderSequence.next()
  state.markdown = md
  chrome.runtime.sendMessage({
    message: 'markdown',
    compiler: state.compiler,
    markdown: frontmatter(state.markdown)
  }, (res) => {
    if (!renderSequence.isCurrent(sequence)) return
    if (chrome.runtime.lastError || !res) {
      console.error(chrome.runtime.lastError || 'Markdown 编译失败')
      return
    }
    state.html = res.html
    if (state.content.emoji) {
      state.html = emojinator(state.html)
    }
    if (state.content.mermaid) {
      state.html = state.html.replace(
        /<code class="language-(?:mermaid|mmd)">/gi,
        '<code class="mermaid">'
      )
    }
    if (state.content.toc) {
      state.toc = toc.render(state.html)
    }
    state.html = anchors(state.html)
    m.redraw()
    if (!editor.state.active && state.preserveScroll !== null) {
      update()
    }
  })
}

function mount () {
  $('pre').style.display = 'none'
  var md = $('pre').innerText
  favicon()

  m.mount($('body'), {
    oninit: () => {
      render(md)
    },
    view: () => {
      var dom = []

      if (state.html || editor.state.active) {
        state._themes.custom = state.custom.color

        var color =
          state._themes[state.theme] === 'dark' ||
          (state._themes[state.theme] === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark' : 'light'

        $('body').classList.remove(...Array.from($('body').classList).filter((name) => /^_theme|_color/.test(name)))
        $('body').classList.toggle('_editing', editor.state.active)
        dom.push(m('link#_theme', {
          onupdate: onupdate.theme,
          rel: 'stylesheet', type: 'text/css',
          href: state.theme !== 'custom' ? chrome.runtime.getURL(`/themes/${state.theme}.css`) : '',
        }))
        $('body').classList.add(`_theme-${state.theme}`, `_color-${color}`)

        if (state.content.syntax) {
          dom.push(m('link#_prism', {
            rel: 'stylesheet', type: 'text/css',
            href: chrome.runtime.getURL(`/vendor/${color === 'dark' ? 'prism-okaidia' : 'prism'}.min.css`),
          }))
        }

        var theme =
          (/github(-dark)?/.test(state.theme) ? 'markdown-body' : 'markdown-theme') +
          (state.themes.width !== 'auto' ? ` _width-${state.themes.width}` : '')

        if (editor.state.active) {
          dom.push(m('textarea#_editor-input', {
            key: 'markdown-source-editor',
            class: theme,
            spellcheck: false,
            'aria-label': 'Markdown 源码',
            oncreate: oncreate.editor,
            oninput: (event) => {
              var dirty = editor.state.dirty
              event.redraw = false
              editor.input(event.target.value)
              if (!dirty) m.redraw()
            },
          }))
        }
        else if (state.raw) {
          if (state.content.syntax) {
            dom.push(m('#_markdown', {oncreate: oncreate.html, onupdate: onupdate.html, class: theme},
              m.trust(`<pre class="language-md"><code class="language-md">${_escape(state.markdown)}</code></pre>`)
            ))
          }
          else {
            dom.push(m('pre#_markdown', {oncreate: oncreate.html, onupdate: onupdate.html}, state.markdown))
          }
        }
        else {
          dom.push(m('#_html', {oncreate: oncreate.html, onupdate: onupdate.html, class: theme},
            m.trust(state.html)
          ))
        }

        if (state.content.toc && !editor.state.active) {
          dom.push(m('#_toc.tex2jax-ignore', m.trust(state.toc)))
          state.raw ? $('body').classList.remove('_toc-left') : $('body').classList.add('_toc-left')
        }
        else {
          $('body').classList.remove('_toc-left')
        }

        if (state.theme === 'custom') {
          dom.push(m('style', {type: 'text/css'}, state.custom.theme))
        }

        dom.push(m('#_editor-controls', [
          m('button#_editor-toggle', {
            type: 'button',
            disabled: editor.state.busy,
            onclick: toggleEditor,
          }, editor.state.busy ? '读取中…' : (editor.state.active ? '退出编辑' : '编辑')),
          editor.state.active && mdFileWriter.canWrite() && m('button#_editor-save', {
            type: 'button',
            title: 'Ctrl/Cmd+S',
            disabled: editor.state.saving || (!editor.state.dirty && !editor.state.external),
            onclick: () => saveEditor(false),
          }, editor.state.saving ? '保存中…' : '保存'),
          editor.state.active && m('button#_editor-export', {
            type: 'button',
            onclick: editor.exportCopy,
          }, '导出副本'),
          editor.state.active && editor.state.external && m('button#_editor-load-external', {
            type: 'button',
            onclick: editor.loadExternal,
          }, '载入磁盘版本'),
          editor.state.active && mdFileWriter.canWrite() && editor.state.external && m('button#_editor-force-save', {
            type: 'button',
            onclick: () => saveEditor(true),
          }, '仍要覆盖'),
          editor.state.active && editor.state.external && m('button#_editor-keep-draft', {
            type: 'button',
            onclick: editor.keepDraft,
          }, '保留草稿'),
          m('span#_editor-status', {
            role: 'status',
            'aria-live': 'polite',
          }, editor.state.status),
        ]))
      }

      return dom
    }
  })
}

var anchors = (html) =>
  html.replace(/(<h[1-6] id="(.*?)">)/g, (header, _, id) =>
    header +
    '<a class="anchor" name="' + id + '" href="#' + id + '">' +
    '<span class="octicon octicon-link"></span></a>'
  )

var toc = (() => {
  var walk = (regex, string, group, result = [], match = regex.exec(string)) =>
    !match ? result : walk(regex, string, group, result.concat(!group ? match[1] :
      group.reduce((all, name, index) => (all[name] = match[index + 1], all), {})))
  return {
    render: (html) =>
      walk(
        /<h([1-6]) id="(.*?)">(.*?)<\/h[1-6]>/gs,
        html,
        ['level', 'id', 'title']
      )
      .reduce((toc, {id, title, level}) => toc +=
        '<div class="_ul">'.repeat(level) +
        '<a href="#' + id + '">' + title.replace(/<a[^>]+>/g, '').replace(/<\/a>/g, '') + '</a>' +
        '</div>'.repeat(level)
      , '')
  }
})()

var frontmatter = (md) => {
  if (/^-{3}[\s\S]+?-{3}/.test(md)) {
    var [, yaml] = /^-{3}([\s\S]+?)-{3}/.exec(md)
    var title = /title: (?:'|")*(.*)(?:'|")*/.exec(yaml)
    title && (document.title = title[1])
  }
  else if (/^\+{3}[\s\S]+?\+{3}/.test(md)) {
    var [, toml] = /^\+{3}([\s\S]+?)\+{3}/.exec(md)
    var title = /title = (?:'|"|`)*(.*)(?:'|"|`)*/.exec(toml)
    title && (document.title = title[1])
  }
  return md.replace(/^(?:-|\+){3}[\s\S]+?(?:-|\+){3}/, '')
}

var favicon = () => {
  var favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.href = chrome.runtime.getURL(`/icons/${state.icon}/16x16.png`)
  $('head').appendChild(favicon)
}

var _escape = (str) =>
  str.replace(/[&<>]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  }[tag] || tag))

if (document.readyState === 'complete') {
  mount()
}
else {
  var timeout = setInterval(() => {
    if (document.readyState === 'complete') {
      clearInterval(timeout)
      mount()
    }
  }, 0)
}
