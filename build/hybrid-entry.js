import {
  CodeBlockAstNode,
  EditorController,
  EditorModel,
  EditorView,
  LocalHistoryStrategy,
  OffsetRange,
  Selection,
  StringValue,
} from '@vscode/markdown-editor'
import {autorun, observableValue} from '@vscode/observables'
import '@vscode/markdown-editor/editor.css'
import '@vscode/markdown-editor/themes/github.css'
import 'katex/dist/katex.min.css'

globalThis.mdHybridLibrary = {
  CodeBlockAstNode,
  EditorController,
  EditorModel,
  EditorView,
  LocalHistoryStrategy,
  OffsetRange,
  Selection,
  StringValue,
  autorun,
  observableValue,
}
