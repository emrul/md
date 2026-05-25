# Mermaid diagrams

Code blocks tagged with the `mermaid` language render as live SVG diagrams via [mermaid.js](https://mermaid.js.org/). Click into the block to edit; the preview updates after a short debounce.

## Flowchart

```mermaid
graph TD
  Start([Start])
  Parse[Parse markdown]
  ApplyMarks[Apply marks]
  Render[Render decorations]
  Done([Done])

  Start --> Parse
  Parse --> ApplyMarks
  ApplyMarks --> Render
  Render --> Done
```

## Sequence diagram

```mermaid
sequenceDiagram
  participant U as User
  participant E as Editor
  participant FS as Wails FileService
  participant D as Disk

  U->>E: ⌘S
  E->>E: serialize doc → markdown
  E->>FS: Save(path, contents)
  FS->>D: write file
  D-->>FS: ok
  FS-->>E: ok
  E-->>U: dirty indicator clears
```

## Class diagram

```mermaid
classDiagram
  class Editor {
    +EditorState state
    +EditorView view
    +commands()
    +chain()
  }
  class HybridReveal {
    -DecorationSet decorations
    +addProseMirrorPlugins()
  }
  class EnhancedCodeBlock {
    +language: string
    +addNodeView()
  }
  Editor "1" o-- "many" HybridReveal
  Editor "1" o-- "many" EnhancedCodeBlock
```

## Gantt chart

```mermaid
gantt
  title MarkdownMD roadmap
  dateFormat YYYY-MM-DD
  section M0 — Foundation
  TypeScript migration    :done, m0a, 2026-04-20, 4d
  Modular tree            :done, m0b, after m0a, 3d
  section M1 — Editing feel
  Hybrid live-preview     :done, m1a, 2026-04-28, 5d
  BubbleMenu + slash menu :done, m1b, after m1a, 4d
  section M2 — Rich blocks
  CodeBlockLowlight       :active, m2a, 2026-05-25, 2d
  Task lists              : m2b, after m2a, 1d
  Tables                  : m2c, after m2b, 3d
  KaTeX math              : m2d, after m2c, 3d
```

## State diagram

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Typing : keypress
  Typing --> Idle : pause > 1s
  Typing --> Saving : ⌘S
  Saving --> Idle : ok
  Saving --> ErrorState : fail
  ErrorState --> Idle : dismiss
```

## Pie chart

```mermaid
pie title Language usage in this doc
  "TypeScript"   : 45
  "Go"           : 15
  "CSS"          : 12
  "Markdown"     : 18
  "HTML"         : 10
```

## What to try

- Click into the source of any mermaid block — you'll see the raw mermaid text; the rendered diagram stays above it.
- Edit the text and pause typing — the preview re-renders after ~350ms.
- A syntax error shows an inline red error banner instead of crashing the editor.
- Use the language chip to switch a regular code block to "Mermaid" and watch it activate.
