# Code blocks

Fenced code blocks render with syntax highlighting via [lowlight](https://github.com/wooorm/lowlight) + highlight.js. Click into any block to reveal the ` ``` ` fence markers, and use the language chip in the top-right of the block to switch languages.

## JavaScript

```javascript
function fibonacci(n) {
  if (n < 2) return n
  let [a, b] = [0, 1]
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b]
  }
  return b
}

console.log(fibonacci(10)) // 55
```

## TypeScript

```typescript
interface User {
  id: string
  email: string
  roles: ReadonlyArray<'admin' | 'editor' | 'viewer'>
}

async function loadUser(id: string): Promise<User | null> {
  const res = await fetch(`/api/users/${id}`)
  if (!res.ok) return null
  return (await res.json()) as User
}
```

## Python

```python
from dataclasses import dataclass
from typing import Iterable

@dataclass(frozen=True)
class Vector:
    x: float
    y: float

    def __add__(self, other: "Vector") -> "Vector":
        return Vector(self.x + other.x, self.y + other.y)

def centroid(points: Iterable[Vector]) -> Vector:
    pts = list(points)
    n = len(pts) or 1
    sx = sum(p.x for p in pts)
    sy = sum(p.y for p in pts)
    return Vector(sx / n, sy / n)
```

## Go

```go
package main

import (
	"fmt"
	"sort"
)

type Event struct {
	Name string
	Ts   int64
}

func latest(events []Event, n int) []Event {
	sort.Slice(events, func(i, j int) bool { return events[i].Ts > events[j].Ts })
	if n > len(events) {
		n = len(events)
	}
	return events[:n]
}

func main() {
	fmt.Println(latest([]Event{{"a", 1}, {"b", 3}, {"c", 2}}, 2))
}
```

## Rust

```rust
use std::collections::HashMap;

fn word_counts(text: &str) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word.to_lowercase()).or_insert(0) += 1;
    }
    counts
}

fn main() {
    let counts = word_counts("the quick brown fox jumps over the lazy dog the");
    for (w, n) in counts {
        println!("{w}: {n}");
    }
}
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

# Sync a workspace to a remote host
HOST="${1:?usage: sync.sh <host>}"
SRC="${HOME}/work/"
DST="${HOST}:/srv/work/"

rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  "${SRC}" "${DST}"

echo "done → ${DST}"
```

## JSON

```json
{
  "name": "markdownmd",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wails3 dev",
    "build": "wails3 build"
  },
  "features": ["hybrid-live-preview", "syntax-highlighting", "mermaid"]
}
```

## YAML

```yaml
service: editor
language: typescript

features:
  hybrid_preview: true
  syntax_highlight:
    enabled: true
    theme: catppuccin-mocha
    languages: [js, ts, py, go, rust, sh, json, yaml, sql, md]

milestones:
  - id: m2
    name: Rich blocks
    tasks: [codeblock, tasklist, table, math]
```

## SQL

```sql
WITH recent_edits AS (
  SELECT user_id, doc_id, MAX(edited_at) AS last_edit
  FROM edits
  WHERE edited_at >= NOW() - INTERVAL '7 days'
  GROUP BY user_id, doc_id
)
SELECT u.email, d.title, r.last_edit
FROM recent_edits r
JOIN users u  ON u.id = r.user_id
JOIN docs  d  ON d.id = r.doc_id
ORDER BY r.last_edit DESC
LIMIT 25;
```

## CSS

```css
:root {
  --bg: #ffffff;
  --text: #1f2328;
  --link: #2563eb;
}

.editor-scroll {
  padding: 40px 56px;
}

.ProseMirror code {
  background: var(--code-bg);
  border-radius: 4px;
  padding: 0.15em 0.4em;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.85em;
}
```

## HTML

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>MarkdownMD</title>
  </head>
  <body>
    <div id="editor"></div>
    <script type="module" src="/src/app/main.ts"></script>
  </body>
</html>
```

## Markdown (inside a code block)

```markdown
# Title

A paragraph with **bold**, _italic_, and `code`.

- a bullet
- another bullet

> a quote
```

## Plain text

```
Plain text blocks have no language and no highlighting.
Useful for logs, ASCII art, or output you don't want tokenized.

  +---+    +---+
  | A | -> | B |
  +---+    +---+
```

## What to try

- Click into any code block — a language chip appears in the top-right of that block.
- Click the chip to open a searchable language list; type to filter, `↑`/`↓` to navigate, `Enter` to select, `Esc` to close.
- Pick "Mermaid" on a block and replace the body with a diagram (see `04-mermaid-diagrams.md`) — the block live-renders.
- Round-trip: save with `⌘S`, reopen — language attributes survive.
