/// <reference types="vite/client" />
// Bundled onboarding documents. The markdown files in ../examples are pulled in
// at build time via import.meta.glob (eager + raw), so they ship inside the app
// binary (frontend/dist is embedded) with no Go service or disk access. Shown on
// first run and via Help → Examples; opened as read-only tabs.

// Vite inlines each matched file's raw text. Keys are the module paths.
const modules = import.meta.glob('../examples/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface Example {
  /** File stem, e.g. "01-welcome" — also the sort key (numbered order). */
  name: string
  /** Tab title, derived from the first H1 or the file name. */
  title: string
  /** Raw markdown. */
  content: string
}

// Title from the document's first ATX H1, else the file stem with the numeric
// prefix dropped and separators spaced out ("02-formatting" → "Formatting").
function deriveTitle(stem: string, content: string): string {
  const h1 = content.match(/^#\s+(.+?)\s*$/m)
  if (h1) return h1[1].trim()
  const cleaned = stem.replace(/^\d+[-_\s]*/, '').replace(/[-_]+/g, ' ')
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) || stem
}

/** The bundled examples in numbered filename order. */
export function loadExamples(): Example[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => {
      const stem = path.split('/').pop()!.replace(/\.md$/, '')
      return { name: stem, title: deriveTitle(stem, content), content }
    })
}
