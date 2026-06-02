const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_ABS_RE = /^[A-Za-z]:[\\/]/

function urlScheme(src: string): string | null {
  return URL_SCHEME_RE.exec(src)?.[0].slice(0, -1).toLowerCase() ?? null
}

function splitResourceSuffix(src: string): { path: string; suffix: string } {
  let split = src.length
  const query = src.indexOf('?')
  const hash = src.indexOf('#')
  if (query >= 0) split = Math.min(split, query)
  if (hash >= 0) split = Math.min(split, hash)
  return { path: src.slice(0, split), suffix: src.slice(split) }
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(0, i) : ''
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_ABS_RE.test(path)
}

function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const drive = /^[A-Za-z]:\//.exec(slashed)?.[0].slice(0, 2) ?? ''
  const absolute = slashed.startsWith('/') || !!drive
  const parts: string[] = []
  for (const part of slashed.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push(part)
    } else {
      parts.push(part)
    }
  }
  const joined = parts.join('/')
  if (drive) return joined
  return absolute ? `/${joined}` : joined
}

function joinPath(baseFile: string, relPath: string): string {
  if (isAbsolutePath(relPath)) return normalizePath(relPath)
  return normalizePath(`${dirname(baseFile)}/${relPath}`)
}

function fileURL(path: string): string {
  let slashed = normalizePath(path).replace(/\\/g, '/')
  if (!slashed.startsWith('/')) slashed = `/${slashed}`
  const encoded = slashed
    .split('/')
    .map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/')
  return `file://${encoded}`
}

function viteFileURL(path: string): string | null {
  if (typeof window === 'undefined') return null
  const viteDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
  if (!viteDev) return null
  if (window.location.protocol !== 'http:') return null
  if (window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') {
    return null
  }
  let slashed = normalizePath(path).replace(/\\/g, '/')
  if (!slashed.startsWith('/')) slashed = `/${slashed}`
  const encoded = slashed
    .split('/')
    .map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/')
  return `/@fs${encoded}`
}

function appImageURL(path: string, suffix: string): string {
  const slashed = normalizePath(path).replace(/\\/g, '/')
  const hashAt = suffix.indexOf('#')
  const query = suffix.startsWith('?') ? suffix.slice(1, hashAt >= 0 ? hashAt : undefined) : ''
  const hash = hashAt >= 0 ? suffix.slice(hashAt) : ''
  const queryParam = query ? `&srcQuery=${encodeURIComponent(query)}` : ''
  return `/__mdmd_file/image?path=${encodeURIComponent(slashed)}${queryParam}${hash}`
}

function localDisplayURL(path: string, suffix: string): string {
  const vite = viteFileURL(path)
  if (vite) return vite + suffix
  if (typeof window === 'undefined') return fileURL(path) + suffix
  return appImageURL(path, suffix)
}

function fileURLPath(src: string): { path: string; suffix: string } | null {
  try {
    const url = new URL(src)
    if (url.protocol !== 'file:') return null
    let path = decodePath(url.pathname)
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    return { path, suffix: `${url.search}${url.hash}` }
  } catch {
    return null
  }
}

export function imageDestination(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('<')) {
    const end = value.indexOf('>')
    if (end > 0) return value.slice(1, end)
  }
  return /^\S+/.exec(value)?.[0] ?? ''
}

export function resolvedImageSrc(
  src: string | null | undefined,
  sourcePath: string | null | undefined,
): string | null | undefined {
  if (!src) return src
  if (src.startsWith('//')) return src
  const scheme = urlScheme(src)
  if (scheme === 'file') {
    const file = fileURLPath(src)
    return file ? localDisplayURL(file.path, file.suffix) : src
  }
  if (scheme) return src

  const { path, suffix } = splitResourceSuffix(src)
  const decoded = decodePath(path)
  if (!decoded) return src

  if (isAbsolutePath(decoded)) return localDisplayURL(decoded, suffix)
  if (!sourcePath) return src
  return localDisplayURL(joinPath(sourcePath, decoded), suffix)
}
