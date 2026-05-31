import {
  ReadDir as $ReadDir,
  HomeDir as $HomeDir,
  ContextualRoot as $ContextualRoot,
  FindGitRoot as $FindGitRoot,
  ParentDir as $ParentDir,
  GitBranch as $GitBranch,
  StatMtimes as $StatMtimes,
  RelativeLinkPath as $RelativeLinkPath,
  ResolveLink as $ResolveLink,
  CreateFileNear as $CreateFileNear,
  CreateFolderNear as $CreateFolderNear,
  ChildLinksForFolder as $ChildLinksForFolder,
} from '../../bindings/markdownmd/app/workspaceservice.js'
import { ChildLink, DirEntry, ReadDirResult } from '../../bindings/markdownmd/app/models.js'

export type { ChildLink, DirEntry, ReadDirResult }

/** A markdown link href resolved (Go-side) against the document that holds it. */
export interface ResolvedLink {
  /** Absolute, cleaned OS path the href points at; '' when it can't resolve. */
  path: string
  exists: boolean
  isMarkdown: boolean
}

/**
 * Resolve an in-document markdown link href to an absolute path — the inverse of
 * relativeLinkPath. fromFile is the document the link lives in ('' for Untitled,
 * where only absolute / file:// hrefs resolve). Strips #fragment / ?query and
 * decodes percent-encoding. Backs the in-editor link preview + ⌘/Ctrl-click open.
 */
export async function resolveLink(fromFile: string, href: string): Promise<ResolvedLink> {
  const r = await $ResolveLink(fromFile, href)
  return { path: r.path ?? '', exists: !!r.exists, isMarkdown: !!r.isMarkdown }
}

export async function readDir(
  path: string,
  opts: { requestID?: string; showDotFolders?: boolean } = {},
): Promise<ReadDirResult> {
  return await $ReadDir(path, opts.requestID ?? '', opts.showDotFolders ?? false)
}

export async function homeDir(): Promise<string> {
  return await $HomeDir()
}

export async function parentDir(path: string): Promise<string> {
  return await $ParentDir(path)
}

/**
 * Contextual root for the explorer's "what to show" rule. Single source of
 * truth lives Go-side (workspaceservice.go ContextualRoot). Pass the active
 * tab's filePath, or empty string for untitled.
 */
export async function contextualRoot(filePath: string): Promise<string> {
  return await $ContextualRoot(filePath)
}

export async function findGitRoot(path: string): Promise<string> {
  return await $FindGitRoot(path)
}

export async function gitBranch(repoRoot: string): Promise<string> {
  return await $GitBranch(repoRoot)
}

export async function statMtimes(paths: string[]): Promise<number[]> {
  return (await $StatMtimes(paths)) ?? []
}

export async function relativeLinkPath(fromFile: string, toFile: string): Promise<string> {
  return await $RelativeLinkPath(fromFile, toFile)
}

export async function createFileNear(refPath: string, name: string): Promise<string> {
  return await $CreateFileNear(refPath, name)
}

export async function createFolderNear(refPath: string, name: string): Promise<string> {
  return await $CreateFolderNear(refPath, name)
}

export async function childLinksForFolder(
  folderPath: string,
  fromFile: string,
): Promise<ChildLink[]> {
  return (await $ChildLinksForFolder(folderPath, fromFile)) ?? []
}

/**
 * Comparator shared between the static (small-folder) and streamed
 * (sorted-insert) render paths. Folders before files, then case-insensitive
 * locale-aware name compare.
 */
export function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}
