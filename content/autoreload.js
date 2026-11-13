
;(() => {
  var busy = false

  var get = async () => {
    if (busy) return
    busy = true
    try {
      editor.observe(await readSource())
    }
    catch (err) {
      console.error(err)
      clearInterval(state.reload.interval)
    }
    finally {
      busy = false
    }
  }

  get()
  state.reload.interval = setInterval(get, state.reload.ms)
})()
