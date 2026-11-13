
md.xhr = () => {

  var get = (url, done) => {
    ;(async () => {
      await new Promise(async (resolve, reject) => {
        try {
          var res = await fetch(url + '?preventCache=' + Date.now())
          done(null, await res.text())
        }
        catch (err) {
          done(err)
        }
      })
    })()
  }

  var snapshot = (url, done) => {
    ;(async () => {
      try {
        var res = await fetch(url + '?preventCache=' + Date.now())
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        var bytes = new Uint8Array(await res.arrayBuffer())
        var bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        var text = new TextDecoder('utf-8').decode(bytes)
        var eol = text.includes('\r\n') ? '\r\n' : (!text.includes('\n') && text.includes('\r') ? '\r' : '\n')
        done(null, {text, bom, eol})
      }
      catch (err) {
        done(err)
      }
    })()
  }

  return {get, snapshot}
}
