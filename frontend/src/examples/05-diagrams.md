# Diagrams

Fence a code block with the `mermaid` language and it renders as a diagram.

## Flowchart

```mermaid
flowchart TD
    A[Open MarkdownMD] --> B{First run?}
    B -- Yes --> C[Show these Examples]
    B -- No --> D[Restore your session]
    C --> E[Start writing]
    D --> E
```

## Sequence diagram

```mermaid
sequenceDiagram
    participant You
    participant Editor
    participant Disk
    You->>Editor: Type Markdown
    Editor->>Editor: Render live (hybrid)
    You->>Editor: ⌘S
    Editor->>Disk: Save plain .md
    Disk-->>Editor: External change?
    Editor-->>You: Reload / keep banner
```

## Pie chart

```mermaid
pie title What's in a great note
    "Ideas" : 50
    "Structure" : 30
    "Polish" : 20
```

Edit the code in any normal (editable) document and the diagram updates as you type.
