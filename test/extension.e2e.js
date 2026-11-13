
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const {spawn} = require('node:child_process')
const {test} = require('node:test')
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core')

const work = process.env.MV_E2E_WORK || 'F:\\temp\\simov-markdown-editor'
const extension = path.resolve(process.env.MV_EXTENSION_DIR || 'build/tmp/markdown-viewer')
const edge = process.env.MV_EDGE_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const sourceBytes = (text) => Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'), 'utf8'),
])

const waitStatus = async (page, text) => {
  try {
    await page.waitForFunction(
      (expected) => document.querySelector('#_editor-status')?.textContent === expected,
      text,
      {timeout: 30000},
    )
  }
  catch (error) {
    console.error('status timeout', {expected: text, actual: await page.locator('#_editor-status').textContent()})
    throw error
  }
}

const extensionId = async (context) => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const worker = context.serviceWorkers().find((item) => item.url().startsWith('chrome-extension://'))
    if (worker) return worker.url().split('/')[2]
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('扩展 Service Worker 未启动')
}

const completeNativePicker = (filename) => new Promise((resolve, reject) => {
  const script = `
$ErrorActionPreference = 'Stop'
$log = '${work.replace(/'/g, "''")}\\native-picker.log'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MDVDialog {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extraInfo);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr hWnd, string text);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
  'helper started' | Out-File -FilePath $log -Encoding utf8
  $pattern = 'Open|Select|' + [char]0x6253 + [char]0x5f00 + '|' + [char]0x9009 + [char]0x53d6 + '|' + [char]0x9009 + [char]0x62e9
  $found = $false
  $seen = @{}
  $hwnd = [IntPtr]::Zero
  $title = New-Object System.Text.StringBuilder 512
  for ($i = 0; $i -lt 160; $i++) {
    $callback = [MDVDialog+EnumWindowsProc] {
      param($candidate, $lParam)
      if (-not [MDVDialog]::IsWindowVisible($candidate)) { return $true }
      $class = New-Object System.Text.StringBuilder 128
      [void][MDVDialog]::GetClassName($candidate, $class, 128)
      if ($class.ToString() -ne '#32770') { return $true }
      $candidateTitle = New-Object System.Text.StringBuilder 512
      [void][MDVDialog]::GetWindowText($candidate, $candidateTitle, 512)
      $seen[($class.ToString() + '|' + $candidateTitle.ToString())] = $true
      if ($candidateTitle.ToString() -match $pattern) {
        $script:hwnd = $candidate
        [void]$candidateTitle.ToString()
        return $false
      }
      return $true
    }
    [void][MDVDialog]::EnumWindows($callback, [IntPtr]::Zero)
    if ($hwnd -ne [IntPtr]::Zero) {
      [void][MDVDialog]::GetWindowText($hwnd, $title, 512)
      $found = $true
      break
    }
    Start-Sleep -Milliseconds 150
  }
  if (-not $found) { throw ('Native file picker not found; foreground=' + ($seen.Keys -join ' | ')) }
  ('dialog=' + $hwnd + '|' + $title.ToString()) | Out-File -FilePath $log -Append -Encoding utf8
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $controls | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName) | $($_.Current.AutomationId) | $($_.Current.ClassName) | $($_.Current.Name)" } | Out-File -FilePath '${work.replace(/'/g, "''")}\\native-controls.txt' -Encoding utf8
  'controls listed' | Out-File -FilePath $log -Append -Encoding utf8
  $edit = $controls | Where-Object { $_.Current.AutomationId -eq '1148' -and $_.Current.ClassName -eq 'Edit' } | Select-Object -First 1
  if (-not $edit) { throw 'Filename edit control not found' }
  [void][MDVDialog]::SetWindowText([IntPtr]$edit.Current.NativeWindowHandle, '${filename.replace(/'/g, "''")}')
  $editText = New-Object System.Text.StringBuilder 1024
  [void][MDVDialog]::GetWindowText([IntPtr]$edit.Current.NativeWindowHandle, $editText, 1024)
  ('filename set; hwnd=' + $edit.Current.NativeWindowHandle + '; value=' + $editText.ToString()) | Out-File -FilePath $log -Append -Encoding utf8
  $open = $controls | Where-Object { $_.Current.AutomationId -eq '1' -and $_.Current.ClassName -eq 'Button' } | Select-Object -First 1
  if (-not $open) { throw 'Open button not found' }
  ('open patterns=' + (($open.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ',')) | Out-File -FilePath $log -Append -Encoding utf8
  [void][MDVDialog]::SendMessage($hwnd, 0x0111, [IntPtr]1, [IntPtr]$open.Current.NativeWindowHandle)
  Start-Sleep -Milliseconds 700
  if ([MDVDialog]::IsWindowVisible($hwnd)) {
    [void][MDVDialog]::SetWindowPos($hwnd, [IntPtr]::new(-1), 20, 20, 1000, 680, 0x0040)
    [void][MDVDialog]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 250
    Set-Clipboard -Value '${filename.replace(/'/g, "''")}'
    $editRect = $edit.Current.BoundingRectangle
    [void][MDVDialog]::SetCursorPos([int]($editRect.Left + $editRect.Width / 2), [int]($editRect.Top + $editRect.Height / 2))
    [MDVDialog]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    [MDVDialog]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 250
    $rect = $open.Current.BoundingRectangle
    $x = [int]($rect.Left + $rect.Width / 2)
    $y = [int]($rect.Top + $rect.Height / 2)
    ('open click=' + $x + ',' + $y) | Out-File -FilePath $log -Append -Encoding utf8
    [void][MDVDialog]::SetCursorPos($x, $y)
    [MDVDialog]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    [MDVDialog]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  }
  'open invoked; hwnd=' + $open.Current.NativeWindowHandle | Out-File -FilePath $log -Append -Encoding utf8
  Start-Sleep -Milliseconds 700
  ('dialog still visible=' + [MDVDialog]::IsWindowVisible($hwnd)) | Out-File -FilePath $log -Append -Encoding utf8
  $script:browserHwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 40 -and $script:browserHwnd -eq [IntPtr]::Zero; $i++) {
    $browserCallback = [MDVDialog+EnumWindowsProc] {
      param($candidate, $lParam)
      if (-not [MDVDialog]::IsWindowVisible($candidate)) { return $true }
      $class = New-Object System.Text.StringBuilder 128
      $browserTitle = New-Object System.Text.StringBuilder 512
      [void][MDVDialog]::GetClassName($candidate, $class, 128)
      [void][MDVDialog]::GetWindowText($candidate, $browserTitle, 512)
      if ($class.ToString() -eq 'Chrome_WidgetWin_1' -and $browserTitle.ToString() -match [regex]::Escape('${path.basename(filename).replace(/'/g, "''")}')) {
        $script:browserHwnd = $candidate
        return $false
      }
      return $true
    }
    [void][MDVDialog]::EnumWindows($browserCallback, [IntPtr]::Zero)
    if ($script:browserHwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 150 }
  }
  if ($script:browserHwnd -ne [IntPtr]::Zero) {
    [uint32]$browserPid = 0
    [void][MDVDialog]::GetWindowThreadProcessId($script:browserHwnd, [ref]$browserPid)
    $allowPattern = 'Allow|Save changes|' + [char]0x5141 + [char]0x8bb8 + '|' + [char]0x4fdd + [char]0x5b58 + [char]0x66f4 + [char]0x6539
    $script:allow = $null
    $permissionSeen = @{}
    for ($i = 0; $i -lt 60 -and -not $script:allow; $i++) {
      $permissionCallback = [MDVDialog+EnumWindowsProc] {
        param($candidate, $lParam)
        if (-not [MDVDialog]::IsWindowVisible($candidate)) { return $true }
        [uint32]$candidatePid = 0
        [void][MDVDialog]::GetWindowThreadProcessId($candidate, [ref]$candidatePid)
        if ($candidatePid -ne $browserPid) { return $true }
        $class = New-Object System.Text.StringBuilder 128
        $candidateTitle = New-Object System.Text.StringBuilder 512
        [void][MDVDialog]::GetClassName($candidate, $class, 128)
        [void][MDVDialog]::GetWindowText($candidate, $candidateTitle, 512)
        $permissionSeen[($class.ToString() + '|' + $candidateTitle.ToString())] = $true
        if ($class.ToString() -notmatch '^Chrome_WidgetWin_') { return $true }
        try {
          $candidateRoot = [System.Windows.Automation.AutomationElement]::FromHandle($candidate)
          $candidateControls = $candidateRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
          $candidateControls | Where-Object { $_.Current.Name } | ForEach-Object { "$candidate | $($_.Current.ControlType.ProgrammaticName) | $($_.Current.AutomationId) | $($_.Current.Name)" } | Out-File -FilePath '${work.replace(/'/g, "''")}\\browser-controls.txt' -Append -Encoding utf8
          $script:allow = $candidateControls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -match $allowPattern } | Select-Object -First 1
          if ($script:allow) { return $false }
        }
        catch {}
        return $true
      }
      if ($i -eq 0) { Remove-Item -LiteralPath '${work.replace(/'/g, "''")}\\browser-controls.txt' -ErrorAction SilentlyContinue }
      [void][MDVDialog]::EnumWindows($permissionCallback, [IntPtr]::Zero)
      if (-not $script:allow) { Start-Sleep -Milliseconds 250 }
    }
    if ($script:allow) {
      ('allow patterns=' + (($script:allow.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ',')) | Out-File -FilePath $log -Append -Encoding utf8
      [void][MDVDialog]::SetWindowPos($script:browserHwnd, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0043)
      [void][MDVDialog]::SetForegroundWindow($script:browserHwnd)
      Start-Sleep -Milliseconds 250
      $allowRect = $script:allow.Current.BoundingRectangle
      [void][MDVDialog]::SetCursorPos([int]($allowRect.Left + $allowRect.Width / 2), [int]($allowRect.Top + $allowRect.Height / 2))
      [MDVDialog]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
      [MDVDialog]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 700
      [void][MDVDialog]::SetWindowPos($script:browserHwnd, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0043)
      'write permission allowed' | Out-File -FilePath $log -Append -Encoding utf8
    }
    else {
      ('write permission button not found; windows=' + ($permissionSeen.Keys -join ' | ')) | Out-File -FilePath $log -Append -Encoding utf8
    }
  }
}
catch {
  ($_ | Out-String) | Out-File -FilePath $log -Append -Encoding utf8
  Write-Error $_
  exit 2
}
`
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {stdio: ['ignore', 'pipe', 'pipe']})
  let stderr = ''
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error(`picker helper timeout\n${stderr}`))
  }, 35000)
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
  child.on('exit', (code) => {
    clearTimeout(timeout)
    return code === 0 ? resolve() : reject(new Error(stderr || `picker helper exit ${code}`))
  })
})

test('真实 Edge：编辑、一次授权、句柄复用与冲突保护', {timeout: 240000}, async (t) => {
  assert.equal(fs.existsSync(path.join(extension, 'manifest.json')), true, '先构建 Chromium 扩展')
  assert.equal(fs.existsSync(edge), true, '找不到 Edge')
  fs.rmSync(work, {recursive: true, force: true})
  fs.mkdirSync(work, {recursive: true})
  const filename = path.join(work, 'document.md')
  const paragraphs = Array.from({length: 80}, (_, index) => `第 ${index + 1} 段，用于滚动位置连续性。\n`).join('\n')
  const initial = `# 初始标题\n\n${paragraphs}`
  fs.writeFileSync(filename, sourceBytes(initial))

  const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    executablePath: edge,
    headless: false,
    viewport: {width: 1280, height: 800},
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--allow-file-access-from-files',
      '--no-first-run',
      '--disable-default-apps',
    ],
  })
  t.after(async () => {
    await context.close()
  })

  const id = await extensionId(context)
  const worker = context.serviceWorkers().find((item) => item.url().startsWith(`chrome-extension://${id}/`))
  const storageDeadline = Date.now() + 15000
  while (!await worker.evaluate(() => new Promise((resolve) => {
    chrome.storage.sync.get((value) => resolve(Boolean(value.content && value.origins && value.theme)))
  }))) {
    if (Date.now() > storageDeadline) throw new Error('扩展默认配置未就绪')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const settings = await context.newPage()
  await settings.goto(`chrome://extensions/?id=${id}`)
  const fileAccess = settings.locator('#checkbox-2')
  await fileAccess.waitFor({timeout: 15000})
  const checked = await fileAccess.evaluate((element) => element.checked ?? element.getAttribute('aria-checked') === 'true')
  if (!checked) await fileAccess.click()
  await settings.waitForTimeout(500)
  await settings.close()

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${id}/popup/index.html`)
  let popupState
  const popupDeadline = Date.now() + 15000
  while (!popupState) {
    try {
      popupState = await popup.evaluate(() => chrome.runtime.sendMessage({message: 'popup'}))
    }
    catch (error) {
      if (Date.now() > popupDeadline) throw error
      await popup.waitForTimeout(100)
    }
  }
  await popup.evaluate(async (content) => {
    await chrome.runtime.sendMessage({message: 'popup.content', content})
    await chrome.runtime.sendMessage({message: 'popup.theme', theme: 'github-dark'})
  }, {...popupState.content, autoreload: true, toc: true})
  await popup.close()

  const page = context.pages().find((item) => !item.url().startsWith('chrome://extensions/')) || await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(filename).href)
  await page.waitForSelector('#_html h1', {timeout: 30000}).catch(async (error) => {
    console.error('E2E startup diagnostics', await page.evaluate(() => ({
      url: location.href,
      body: document.body.innerText.slice(0, 300),
      writer: document.documentElement.dataset.mdFileWriter,
    })))
    console.error('E2E workers', context.serviceWorkers().map((worker) => worker.url()))
    console.error('E2E page errors', errors)
    throw error
  })
  assert.equal(await page.locator('#_html h1').textContent(), '初始标题')
  assert.equal(await page.locator('#_toc').count(), 1)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.mdFileWriter), 'ready')

  await page.evaluate(() => window.scrollTo(0, 600))
  await page.locator('#_editor-toggle').click()
  const textarea = page.locator('#_editor-input')
  await textarea.waitFor()
  assert.equal(await textarea.inputValue(), initial)
  assert.equal(await page.locator('#_toc').count(), 0)
  assert.equal(await page.locator('body').evaluate((element) => element.classList.contains('_color-dark')), true)
  assert.equal(await textarea.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(13, 17, 23)')

  await textarea.evaluate((element) => {
    window.__editorNode = element
    element.focus()
    element.setSelectionRange(0, 0)
    element.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}))
    element.value = `中${element.value}`
    element.setSelectionRange(1, 1)
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: '中', inputType: 'insertCompositionText', isComposing: true,
    }))
    element.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data: '中'}))
  })
  assert.equal(await page.evaluate(() => window.__editorNode === document.querySelector('#_editor-input')), true)
  assert.equal(await textarea.evaluate((element) => element.selectionStart), 1)

  const first = `# 已修改\n\n中文 IME\n\n${paragraphs}`
  await textarea.fill(first)
  await page.evaluate(() => {
    window.__writerEvents = []
    document.addEventListener('md:source-file-save-request', (event) => {
      window.__writerEvents.push({
        type: 'request', detail: Boolean(event.detail), keys: event.detail ? Object.keys(event.detail) : [],
        name: event.detail && event.detail.expectedName,
      })
    })
    document.addEventListener('md:source-file-save-response', (event) => {
      window.__writerEvents.push({type: 'response', detail: event.detail})
    })
  })
  const picker = completeNativePicker(filename).then(() => page.bringToFront())
  await page.locator('#_editor-save').click()
  await Promise.all([waitStatus(page, '已保存原文件'), picker]).catch(async (error) => {
    console.error('first save diagnostics', await page.locator('#_editor-status').textContent(), errors)
    console.error('writer events', await page.evaluate(() => window.__writerEvents))
    await page.screenshot({path: path.join(work, 'first-save-failure.png')})
    throw error
  })
  assert.equal(fs.readFileSync(filename).equals(sourceBytes(first)), true, '首次保存必须覆盖真实磁盘并保留 BOM/CRLF')
  assert.equal(await page.locator('#_editor-save').isDisabled(), true)

  const second = `${first}\n第二次保存不选择路径。\n`
  await textarea.fill(second)
  await page.keyboard.press('Control+s')
  await waitStatus(page, '已保存原文件')
  assert.equal(fs.readFileSync(filename).equals(sourceBytes(second)), true)

  await page.reload()
  await page.waitForSelector('#_html h1')
  const readingScroll = 900
  await page.evaluate((offset) => window.scrollTo(0, offset), readingScroll)
  await page.waitForSelector('#_editor-toggle')
  await page.locator('#_editor-toggle').click()
  await page.locator('#_editor-input').waitFor()
  const third = `${second}\n刷新后复用句柄。\n`
  await page.locator('#_editor-input').fill(third)
  await page.keyboard.press('Control+s')
  await waitStatus(page, '已保存原文件')
  assert.equal(fs.readFileSync(filename).equals(sourceBytes(third)), true)

  const draft = `${third}\n未保存草稿。\n`
  await page.locator('#_editor-input').fill(draft)
  fs.writeFileSync(filename, sourceBytes(`# 外部修改\n\n${paragraphs}`))
  await page.locator('#_editor-force-save').waitFor({timeout: 15000})
  assert.equal(await page.locator('#_editor-input').inputValue(), draft)
  await page.locator('#_editor-keep-draft').click()
  await page.waitForTimeout(1400)
  assert.equal(await page.locator('#_editor-force-save').count(), 0, '同一外部版本不应每秒重复提示')
  assert.equal(await page.locator('#_editor-input').inputValue(), draft)

  await page.locator('#_editor-save').click()
  await page.locator('#_editor-force-save').waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#_editor-force-save').click()
  await waitStatus(page, '已保存原文件')
  assert.equal(fs.readFileSync(filename).equals(sourceBytes(draft)), true)

  const disk = `# 磁盘版本\n\n${paragraphs}`
  fs.writeFileSync(filename, sourceBytes(disk))
  await page.locator('#_editor-load-external').waitFor({timeout: 15000})
  await page.locator('#_editor-load-external').click()
  assert.equal(await page.locator('#_editor-input').inputValue(), disk)
  await page.locator('#_editor-toggle').click()
  await page.waitForSelector('#_html h1').catch(async (error) => {
    console.error('preview visibility diagnostics', await page.evaluate(() => ({
      html: document.querySelector('#_html')?.outerHTML.slice(0, 300),
      visibility: document.querySelector('#_html') && getComputedStyle(document.querySelector('#_html')).visibility,
      inline: document.querySelector('#_html')?.style.cssText,
      body: document.body.className,
      scrollY: window.scrollY,
    })), errors)
    await page.screenshot({path: path.join(work, 'preview-visibility-failure.png')})
    throw error
  })
  assert.equal(await page.locator('#_html h1').textContent(), '磁盘版本')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - readingScroll) < 5, '退出编辑应恢复本次进入前的阅读位置')
  assert.deepEqual(errors, [], `页面不应有未捕获异常：${errors.join('\n')}`)
})
