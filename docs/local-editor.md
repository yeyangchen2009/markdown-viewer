# 本地 Markdown 编辑与保存

## 阅读页快捷控件

右下角使用 SVG 图标，不再显示常驻文字按钮。控件载入后短暂显示，随后自动隐藏；鼠标移入右下热区、悬停或键盘聚焦时重新显示，触屏设备常显，打印时隐藏。普通成功、取消和错误提示会随控件自动收起，状态文本约 5 秒后清空；只有保存中和需要用户处理的外部修改冲突保持展开。

| 图标 | 操作 | 作用范围 |
|---|---|---|
| 笔 | 进入或退出 Preview 编辑 | 当前文档，保留未保存草稿 |
| 三横 | 显示或隐藏 TOC | 仅当前页面，不刷新，不改设置 |
| 磁盘 | 保存原文件 | 有未保存修改时可用 |

设置中的 TOC 选项决定新页面的初始状态，三横只覆盖当前页的显示状态。图标按钮都有 `aria-label`、`title` 和键盘焦点样式。

## 使用

1. 在扩展详情页开启「允许访问文件 URL」；新版 Edge 还需开启站点访问中的 `file:///*`。
2. 打开本地 Markdown，点击右下角笔形图标。首次编辑时，在系统对话框中选择**当前打开的同名文件**，并允许浏览器提出的「保存更改」写权限请求。扩展不能从 `file://` 地址静默推导写权限，也不能把当前路径预填为已选文件。固定的选择框 `id` 可帮助浏览器记住上次目录；只有成功复用文件句柄时才会省去选择框。
3. 选择并授权成功后直接在 Preview 中修改。非活动块保留标题、列表、表格和任务框等渲染形态，当前编辑块显示原始 Markdown 标记；底层模型始终保存精确源文，不经过 HTML 反向转换。按 **Ctrl/Cmd+S** 或点击磁盘图标直接写回，不再选择路径。每次保存会先查询权限，`granted` 时不弹窗；如果浏览器在选择文件后消耗了用户激活、未能在进入编辑时完成授权，下一次保存点击会先重试权限请求，再读盘和写入。
4. 如果进入编辑时取消选择或连接失败，仍可在本页编辑并保留草稿；之后点击保存可以重新选择当前文件。扩展不提供另存为、导出或自动下载副本。
5. 同一页面后续保存复用句柄。刷新后优先从 IndexedDB 恢复句柄，权限仍为 `granted` 时不选择路径也不弹窗；权限回到 `prompt` 时，需要一次新的点击或键盘操作重新授权，明确拒绝后不会写入。浏览器不支持恢复时会重新要求选择，这是正常降级。

实现参照 VS Code 当前源码的两段路径：[`fileDialogService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/dialogs/browser/fileDialogService.ts) 通过 `showOpenFilePicker()` 取得文件句柄，[`htmlFileSystemProvider.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/browser/htmlFileSystemProvider.ts) 用内存 Map 与 IndexedDB 复用句柄，并在 `writeFile()` 中直接 `createWritable()`。本扩展额外在进入编辑和每次保存的用户操作起点调用 `queryPermission({mode: 'readwrite'})`，只有状态为 `prompt` 时才请求授权；最终仍由 `createWritable()` 让浏览器执行权限检查，不自行绕过授权。

Preview 混合编辑使用与 VS Code 编辑器实验包相同的 `@vscode/markdown-editor@0.0.2-179`。`model.sourceText` 是唯一编辑源文，任务框勾选和文本修改都写回该模型；Mermaid 非活动块交给现有渲染器，点击图表映射回原始 fence。编辑器 host 在页面中持久存在，阅读和编辑只切换显示状态，避免重绘破坏焦点、选区、中文输入与 undo/redo。明暗主题、正文宽度和 TOC 布局沿用当前阅读页。

进入编辑时，扩展优先把预览视口中可见的块文本匹配到源码，将光标和编辑视口移到对应行；复杂行内标记或渲染内容无法匹配时，按阅读进度近似定位。再次点击笔形图标退出编辑，保留内存草稿、显示最新预览，并恢复本次进入前的阅读位置。未保存时关闭或刷新页面会触发浏览器提示；本地写回失败只保留草稿，不会显示为保存成功，也不会改成下载副本。

```mermaid
%%{init: {'theme':'dark','themeVariables':{'background':'#0d1117','primaryColor':'#1f6feb','primaryTextColor':'#ffffff','primaryBorderColor':'#79c0ff','secondaryColor':'#21262d','tertiaryColor':'#30363d','lineColor':'#8b949e','textColor':'#e6edf3','clusterBkg':'#161b22','clusterBorder':'#58a6ff','edgeLabelBackground':'#21262d','fontSize':'15px'}}}%%
flowchart TD
  A["点击编辑"] --> B["准备当前文件句柄并确认读写权限"]
  A --> C["读取精确磁盘快照"]
  B -->|"选择、恢复并授权成功"| D["编辑内存草稿"]
  B -->|"取消或失败，仍可本页编辑"| D
  C --> D
  D --> E["点击保存"]
  E --> F["先准备句柄并确认读写权限"]
  F -->|"取消或拒绝"| D
  F -->|"已授权"| G["重新读取磁盘并核对外部变化"]
  G -->|"没有外部变化"| H{"新选句柄已核对？"}
  H -->|"是"| I["createWritable 直接写入"]
  H -->|"否"| J["核对精确磁盘文本并持久化句柄"]
  J --> I
  G -->|"发现外部变化"| K["停止覆盖并提示"]
  K -->|"载入磁盘版本"| C
  K -->|"保留草稿"| D
  K -->|"明确仍要覆盖"| H
  I -->|"写入成功"| L["更新磁盘基线"]
  I -->|"取消或失败"| D
  L -->|"保存期间又输入"| D
  L -->|"没有后续输入"| M["清除未保存状态"]
```

## 数据保护边界

| 情况 | 行为 |
|---|---|
| 自动刷新发现外部修改 | 编辑中或有草稿时只提示，不覆盖 Preview 中的草稿 |
| 保存前发现外部修改 | 停止保存；强制覆盖需要再次确认 |
| 保存期间继续输入 | 只保存开始时的快照，后续输入保持未保存 |
| 进入编辑时取消或连接失败 | 保留本页编辑和草稿，保存时显式重试 |
| 用户取消、权限拒绝、写失败 | 保留草稿；写失败调用 `abort()`，不提交临时文件 |
| 本地写回不可用 | 明确报错，不自动下载副本 |
| 远程文档 / Firefox | 不显示原文件「保存」按钮；可在本页编辑，但修改只保留在内存中 |

首版面向 **UTF-8 Markdown**，保留 UTF-8 BOM、LF 或 CRLF 及末尾换行。混合换行会统一为原文的主要换行格式；其他编码不承诺字节级往返。编辑时选择的新句柄先核对文件名，首次保存时再核对精确磁盘文本，降低误选其他同名文件的风险，但浏览器不向扩展暴露完整路径。

## 测试

```bash
npm test
npm run test:e2e
```

E2E 依赖 `playwright-core` 和本机 Edge，使用 headed persistent context。可设置：

- `MV_EDGE_EXECUTABLE`：Edge 可执行文件；
- `MV_EXTENSION_DIR`：已构建扩展目录；
- `MV_E2E_WORK`：测试目录，默认 `F:\temp\simov-markdown-editor`；
- `PLAYWRIGHT_CORE_PATH`：复用其他本地安装的 `playwright-core`，避免重复下载。

Windows 测试驱动只向原生文件选择器输入临时副本路径。不得把 mock picker 的结果当作真实授权或真实磁盘覆盖。

## 在 Windows 上构建

`content/hybrid/` 已提交完整 IIFE、CSS、本地 codicon/KaTeX 字体和 `THIRD-PARTY-LICENSES.txt`，日常打包不需要 npm 或外网。只有修改 Preview 编辑器内核或升级依赖时才需要重建：

```bash
npm ci
npm run build:hybrid
```

`build/build-hybrid.mjs` 使用 lockfile 固定的依赖和 esbuild，将 `build/hybrid-entry.js` 构建为 classic script 可加载的 IIFE。`@vscode/diff` 由编辑器以 `useWasm: false` 调用，使用纯 JavaScript diff，不加载 WASM 或远程代码。重建后应确认 `content/hybrid/` 的变更符合预期，并重新运行真实 Edge E2E。

上游 5.3 的完整 `build/package.sh` 仍依赖旧版 `node-sass`，在没有 Visual Studio C++ 工具链的新 Node 环境中会失败。可从 **simov 5.3 官方 Release** 下载同版本 `markdown-viewer-v5.3.zip`，保留其 vendor/themes，再覆盖本地源码：

```bash
python build/package-release.py F:/temp/simov-markdown-editor-build/markdown-viewer-v5.3.zip \
  --browser chrome \
  --work-dir F:/temp/simov-markdown-editor-build/chrome \
  --output F:/Data/markdown-viewer/dist/edge
```

脚本会核对 Release 与源码 manifest 版本，生成 `dist/edge-v5.3-editor.zip`，并校验 ZIP CRC 和文件集合。官方 Release 仅作为构建依赖基线，功能改动来自当前工作区。
