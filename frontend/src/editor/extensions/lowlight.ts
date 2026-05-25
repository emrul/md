import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import plaintext from 'highlight.js/lib/languages/plaintext'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

export const lowlight = createLowlight()

lowlight.register('bash', bash)
lowlight.register('sh', bash)
lowlight.register('shell', shell)
lowlight.register('c', c)
lowlight.register('cpp', cpp)
lowlight.register('c++', cpp)
lowlight.register('css', css)
lowlight.register('go', go)
lowlight.register('java', java)
lowlight.register('javascript', javascript)
lowlight.register('js', javascript)
lowlight.register('jsx', javascript)
lowlight.register('json', json)
lowlight.register('markdown', markdown)
lowlight.register('md', markdown)
lowlight.register('php', php)
lowlight.register('python', python)
lowlight.register('py', python)
lowlight.register('ruby', ruby)
lowlight.register('rb', ruby)
lowlight.register('rust', rust)
lowlight.register('rs', rust)
lowlight.register('sql', sql)
lowlight.register('typescript', typescript)
lowlight.register('ts', typescript)
lowlight.register('tsx', typescript)
lowlight.register('html', xml)
lowlight.register('xml', xml)
lowlight.register('yaml', yaml)
lowlight.register('yml', yaml)
lowlight.register('mermaid', plaintext)
lowlight.register('plaintext', plaintext)
lowlight.register('text', plaintext)

export interface LanguageOption {
  id: string
  label: string
  search: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: '', label: 'Plain Text', search: 'plain text plaintext none' },
  { id: 'bash', label: 'Bash / Shell', search: 'bash sh shell zsh' },
  { id: 'c', label: 'C', search: 'c clang' },
  { id: 'cpp', label: 'C++', search: 'cpp cplusplus c++' },
  { id: 'css', label: 'CSS', search: 'css stylesheet' },
  { id: 'go', label: 'Go', search: 'go golang' },
  { id: 'html', label: 'HTML', search: 'html xml markup' },
  { id: 'java', label: 'Java', search: 'java jvm' },
  { id: 'javascript', label: 'JavaScript', search: 'javascript js node' },
  { id: 'json', label: 'JSON', search: 'json' },
  { id: 'jsx', label: 'JSX', search: 'jsx react' },
  { id: 'markdown', label: 'Markdown', search: 'markdown md' },
  { id: 'mermaid', label: 'Mermaid', search: 'mermaid diagram graph' },
  { id: 'php', label: 'PHP', search: 'php' },
  { id: 'python', label: 'Python', search: 'python py' },
  { id: 'ruby', label: 'Ruby', search: 'ruby rb rails' },
  { id: 'rust', label: 'Rust', search: 'rust rs' },
  { id: 'sql', label: 'SQL', search: 'sql postgres mysql sqlite' },
  { id: 'typescript', label: 'TypeScript', search: 'typescript ts' },
  { id: 'tsx', label: 'TSX', search: 'tsx react typescript' },
  { id: 'yaml', label: 'YAML', search: 'yaml yml' },
]

const ID_TO_LABEL = new Map(LANGUAGE_OPTIONS.map((o) => [o.id, o.label]))

export function languageLabel(id: string | null | undefined): string {
  if (!id) return 'Plain Text'
  return ID_TO_LABEL.get(id) ?? id
}
