package app

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// FolderListingPiggybackThreshold caps how many folder entries we'll scan
// inline during ReadDir for emptiness + git-root detection. Above this we
// skip the piggyback for that listing and rely on idle backfill from the
// frontend.
//
// Tight on purpose: a markdown workspace with >200 subfolders in one dir is
// unusual, and we'd rather pay the cost than have the rare folder render
// then vanish.
const FolderListingPiggybackThreshold = 200

// piggybackWorkers bounds the goroutines used for the per-subfolder scan.
const piggybackWorkers = 16

// EmptyFolderGraceWindow keeps a still-empty folder visible for a while after
// its last modification, so a user who just made a folder (right-click → New
// Folder) can see it and drop a file in before the empty-folder filter would
// otherwise hide it. A folder's mtime is stamped on creation and bumped by any
// add/remove inside it, so this also covers "I just emptied this folder" — it
// lingers briefly rather than vanishing under the cursor. Once the window
// passes and the folder is still empty, the next read drops it. This replaces
// the frontend's optimistic-injection workarounds for create/rename.
const EmptyFolderGraceWindow = 15 * time.Minute

// DirEntry is one row in a ReadDirResult.
//
// GitRoot is the absolute path of the enclosing git repo, or "" when the
// entry isn't in any repo. For a folder whose own subtree contains a .git
// entry, GitRoot equals Path; the frontend uses that equality to render the
// "this is a repo root" decoration.
//
// Mtime is the entry's modification time in Unix milliseconds. Populated for
// folders (used by cache validity check); 0 for files.
type DirEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Mtime   int64  `json:"mtime,omitempty"`
	GitRoot string `json:"gitRoot,omitempty"`
}

// ReadDirResult is the response from ReadDir.
//
// ParentMtime is the listing path's own mtime in Unix milliseconds. The
// frontend caches it for validity checks via StatMtimes.
//
// EmptinessUnknown is set when the piggyback scan was skipped (parent had
// >FolderListingPiggybackThreshold folder entries). In that mode all folders
// are returned (empty filter not applied) and Mtimes are populated via a
// stat-only pass. The frontend should treat this listing as a placeholder
// suitable for rendering, and arrange for idle backfill later.
//
// Streaming + RequestID are populated when the directory had more entries
// than fit in a single chunk; the goroutine continues emitting
// dir-batch:<RequestID> events until dir-done:<RequestID>. (Streaming is
// step 9; not yet implemented.)
type ReadDirResult struct {
	Path             string     `json:"path"`
	ParentMtime      int64      `json:"parentMtime"`
	GitRoot          string     `json:"gitRoot"`
	Entries          []DirEntry `json:"entries"`
	EmptinessUnknown bool       `json:"emptinessUnknown,omitempty"`
	Streaming        bool       `json:"streaming,omitempty"`
	RequestID        string     `json:"requestId,omitempty"`
}

// WorkspaceService owns the explorer's filesystem-facing operations. Stateful:
// holds the per-process git-root cache (primed by the piggyback and FindGitRoot
// walk-ups) and (later) the pending-cancel map used for streaming reads.
type WorkspaceService struct {
	logs *LogService

	gitMu    sync.RWMutex
	gitRoots map[string]string // dir → its git root path, or "" for known non-repo
}

func NewWorkspaceService(logs *LogService) *WorkspaceService {
	return &WorkspaceService{
		logs:     logs,
		gitRoots: make(map[string]string),
	}
}

// HomeDir returns the OS user's home directory.
func (s *WorkspaceService) HomeDir() (string, error) {
	return os.UserHomeDir()
}

// ParentDir returns the parent directory of path, using OS-correct path
// semantics (handles trailing separators, drive letters on Windows, etc.).
// At the filesystem root, ParentDir(root) == root — callers use this as the
// signal that the Up button should be disabled.
func (s *WorkspaceService) ParentDir(path string) (string, error) {
	if path == "" {
		return "", errors.New("path required")
	}
	return filepath.Dir(path), nil
}

// ContextualRoot returns the directory the explorer should show on open
// given the active tab's filePath. Rules:
//
//   - Empty / untitled → $HOME.
//   - File whose ancestry contains a .git → that git root.
//   - File outside any git repo → file's immediate parent dir.
//
// The whole point: editing a file deep in a project shows the whole project,
// not just the immediate folder. Single source of truth for the contextual
// root so the frontend doesn't repeat the rule.
func (s *WorkspaceService) ContextualRoot(filePath string) (string, error) {
	if filePath == "" {
		return os.UserHomeDir()
	}
	if root, _ := s.FindGitRoot(filePath); root != "" {
		return root, nil
	}
	return filepath.Dir(filePath), nil
}

// FindGitRoot walks up from path looking for a .git entry (file or dir —
// worktrees use a file). Returns the absolute path of the containing git
// repo, or "" if no ancestor has .git. Per-process memo cache keyed by the
// directory; primed by the piggyback for any folder the explorer has
// touched. The walk-up checks the cache at each step, so a deep file whose
// ancestor is already cached short-circuits in O(1).
func (s *WorkspaceService) FindGitRoot(path string) (string, error) {
	if path == "" {
		return "", errors.New("path required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		// A non-existent path has no enclosing repo. Returning ("", nil)
		// here keeps brief stale calls (e.g. a render that races a rename)
		// from spamming Wails' "Binding call failed" log; the answer is
		// semantically correct either way.
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	dir := path
	if !info.IsDir() {
		dir = filepath.Dir(path)
	}

	var visited []string
	cur := dir
	for {
		// Cache check at every step — not just the entry. Lets a deep file
		// whose ancestor is already cached short-circuit immediately.
		s.gitMu.RLock()
		if root, ok := s.gitRoots[cur]; ok {
			s.gitMu.RUnlock()
			s.cacheMany(visited, root)
			return root, nil
		}
		s.gitMu.RUnlock()

		visited = append(visited, cur)
		if _, err := os.Lstat(filepath.Join(cur, ".git")); err == nil {
			s.cacheMany(visited, cur)
			return cur, nil
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			// FS root reached. Cache "" for everything we visited.
			s.cacheMany(visited, "")
			return "", nil
		}
		cur = parent
	}
}

func (s *WorkspaceService) cacheMany(dirs []string, root string) {
	if len(dirs) == 0 {
		return
	}
	s.gitMu.Lock()
	for _, d := range dirs {
		s.gitRoots[d] = root
	}
	s.gitMu.Unlock()
}

// StatMtimes returns the modification time (Unix ms) for each given path.
// Order matches the input; 0 indicates the path could not be stat'd
// (deleted, permission denied, etc.). Used by the frontend cache validity
// check to compare parent + cached-subfolder mtimes in a single round-trip.
func (s *WorkspaceService) StatMtimes(paths []string) ([]int64, error) {
	out := make([]int64, len(paths))
	for i, p := range paths {
		if p == "" {
			continue
		}
		if info, err := os.Lstat(p); err == nil {
			out[i] = info.ModTime().UnixMilli()
		}
	}
	return out, nil
}

// ReadDir lists the immediate children of path, applying the explorer's
// render filter (dotfiles hidden, non-markdown files hidden, empty folders
// hidden unless modified within EmptyFolderGraceWindow) and annotating each
// surviving subfolder with its GitRoot.
//
// showDotFolders controls whether directories starting with `.` are listed
// AND whether they count as content for the empty-folder filter (so the
// rules stay consistent: if dot-folders are hidden, a parent containing
// only dot-folders is also hidden).
//
// The requestID parameter is reserved for the streaming protocol (step 9);
// for now ReadDir is monolithic.
func (s *WorkspaceService) ReadDir(path string, requestID string, showDotFolders bool) (ReadDirResult, error) {
	res := ReadDirResult{Path: path}
	if path == "" {
		return res, errors.New("path required")
	}

	parentInfo, statErr := os.Lstat(path)
	if statErr == nil {
		res.ParentMtime = parentInfo.ModTime().UnixMilli()
	}

	parentGitRoot, _ := s.FindGitRoot(path)
	res.GitRoot = parentGitRoot

	raw, err := os.ReadDir(path)
	if err != nil {
		s.logs.Warn("workspace", "ReadDir "+path+": "+err.Error())
		return res, err
	}

	// Pass 1 — split into folders/files, apply file filter, spot parent's .git.
	var folders []os.DirEntry
	var files []os.DirEntry
	for _, e := range raw {
		name := e.Name()
		if name == ".git" {
			if res.GitRoot == "" {
				res.GitRoot = path
				s.cacheGitRoot(path, path)
			}
			continue
		}
		if e.Type().IsDir() {
			if !showDotFolders && strings.HasPrefix(name, ".") {
				continue
			}
			folders = append(folders, e)
			continue
		}
		if strings.HasPrefix(name, ".") {
			continue
		}
		if !isMarkdownFile(name) {
			continue
		}
		files = append(files, e)
	}

	// Sort folders and files BEFORE the piggyback — folderResults must align
	// with the sorted order or we'd assign wrong emptiness/git/mtime to rows.
	sortDirEntries(folders)
	sortDirEntries(files)

	// Pass 2 — piggyback scan on folders (skip if parent has wide fan-out).
	skipPiggyback := len(folders) > FolderListingPiggybackThreshold
	folderResults := make([]scanResult, len(folders))
	if skipPiggyback {
		res.EmptinessUnknown = true
		s.statOnlyPass(path, folders, folderResults)
	} else {
		s.piggybackScan(path, folders, folderResults, showDotFolders)
	}

	// Pass 3 — assemble entries.
	now := time.Now().UnixMilli()
	out := make([]DirEntry, 0, len(folders)+len(files))
	for i, f := range folders {
		if !skipPiggyback && !folderResults[i].hasContent &&
			!withinEmptyFolderGrace(folderResults[i].mtime, now) {
			continue // empty folder, past its just-created grace window
		}
		sub := filepath.Join(path, f.Name())
		entryGitRoot := res.GitRoot
		if folderResults[i].isGitRoot {
			entryGitRoot = sub
			s.cacheGitRoot(sub, sub)
		}
		out = append(out, DirEntry{
			Name:    f.Name(),
			Path:    sub,
			IsDir:   true,
			Mtime:   folderResults[i].mtime,
			GitRoot: entryGitRoot,
		})
	}
	for _, f := range files {
		out = append(out, DirEntry{
			Name:    f.Name(),
			Path:    filepath.Join(path, f.Name()),
			IsDir:   false,
			GitRoot: res.GitRoot,
		})
	}

	res.Entries = out
	return res, nil
}

// CreateFileNear creates an empty file with the given name relative to
// refPath. If refPath is a directory the file goes inside it; if refPath
// is a file the new file lands in refPath's parent dir. Name must not
// contain path separators. Returns the new absolute path.
func (s *WorkspaceService) CreateFileNear(refPath, name string) (string, error) {
	dir, err := parentForCreate(refPath, name)
	if err != nil {
		return "", err
	}
	newPath := filepath.Join(dir, name)
	if _, err := os.Stat(newPath); err == nil {
		return "", errors.New("a file with that name already exists")
	}
	f, err := os.OpenFile(newPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return newPath, nil
}

// CreateFolderNear is the directory counterpart of CreateFileNear.
func (s *WorkspaceService) CreateFolderNear(refPath, name string) (string, error) {
	dir, err := parentForCreate(refPath, name)
	if err != nil {
		return "", err
	}
	newPath := filepath.Join(dir, name)
	if _, err := os.Stat(newPath); err == nil {
		return "", errors.New("a file with that name already exists")
	}
	if err := os.Mkdir(newPath, 0o755); err != nil {
		return "", err
	}
	return newPath, nil
}

func parentForCreate(refPath, name string) (string, error) {
	if refPath == "" || name == "" {
		return "", errors.New("refPath and name required")
	}
	if name != filepath.Base(name) {
		return "", errors.New("name cannot contain path separators")
	}
	info, err := os.Lstat(refPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return refPath, nil
	}
	return filepath.Dir(refPath), nil
}

// GitBranch returns the current branch name for the repo rooted at
// repoRoot, or "" when it can't be determined (detached HEAD returns a
// short commit hash). Reads .git/HEAD directly — no git binary needed.
// Handles the worktree/submodule case where .git is a file pointing at the
// real git dir via "gitdir: <path>".
func (s *WorkspaceService) GitBranch(repoRoot string) (string, error) {
	if repoRoot == "" {
		return "", nil
	}
	gitPath := filepath.Join(repoRoot, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return "", nil
	}
	headPath := filepath.Join(gitPath, "HEAD")
	if !info.IsDir() {
		// .git is a file: "gitdir: <path-to-real-git-dir>"
		data, err := os.ReadFile(gitPath)
		if err != nil {
			return "", nil
		}
		line := strings.TrimSpace(string(data))
		dir := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
		if dir == "" {
			return "", nil
		}
		if !filepath.IsAbs(dir) {
			dir = filepath.Join(repoRoot, dir)
		}
		headPath = filepath.Join(dir, "HEAD")
	}
	data, err := os.ReadFile(headPath)
	if err != nil {
		return "", nil
	}
	content := strings.TrimSpace(string(data))
	if ref, ok := strings.CutPrefix(content, "ref: "); ok {
		// refs/heads/feature/foo → feature/foo
		return strings.TrimPrefix(ref, "refs/heads/"), nil
	}
	// Detached HEAD: content is a commit hash. Show a short form.
	if len(content) >= 7 {
		return content[:7], nil
	}
	return "", nil
}

// ChildLink describes one direct markdown child of a folder along with the
// relative-link path to use when rendering as a markdown link. Used by
// drag-folder-to-editor (insert bullet list of children).
type ChildLink struct {
	// Name is the filename minus its markdown extension — display text.
	Name string `json:"name"`
	// Href is the path computed by RelativeLinkPath (./foo.md, ../bar.md,
	// or file:/// URL for the untitled / cross-drive cases).
	Href string `json:"href"`
}

// ChildLinksForFolder returns sorted markdown-link metadata for every
// direct markdown child of folderPath. Non-recursive — descendants are
// not walked. Dotfiles are excluded as usual; dot-folders aren't relevant
// here since we only enumerate files.
//
// fromFile is the receiving document's path (or empty for Untitled).
func (s *WorkspaceService) ChildLinksForFolder(folderPath, fromFile string) ([]ChildLink, error) {
	if folderPath == "" {
		return nil, errors.New("folderPath required")
	}
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return nil, err
	}
	var out []ChildLink
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if !isMarkdownFile(name) {
			continue
		}
		full := filepath.Join(folderPath, name)
		href, _ := s.RelativeLinkPath(fromFile, full)
		display := strings.TrimSuffix(name, filepath.Ext(name))
		out = append(out, ChildLink{Name: display, Href: href})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// RelativeLinkPath computes a markdown-link-suitable path from one file to
// another. Used by drag-to-editor.
//
// Returns either a posix-style relative path (forward slashes) like
// "./api.md" or "../notes/api.md", or a "file://" absolute URL when
// relativization isn't meaningful (untitled source, cross-drive on Windows).
func (s *WorkspaceService) RelativeLinkPath(fromFile, toFile string) (string, error) {
	if toFile == "" {
		return "", errors.New("toFile required")
	}
	if fromFile == "" {
		return fileURL(toFile), nil
	}
	fromDir := filepath.Dir(fromFile)
	rel, err := filepath.Rel(fromDir, toFile)
	if err != nil {
		return fileURL(toFile), nil
	}
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, "../") && !strings.HasPrefix(rel, "./") {
		rel = "./" + rel
	}
	return rel, nil
}

// fileURL builds a standards-compliant file:// URL from an absolute path.
// POSIX:  /foo/bar      -> file:///foo/bar
// Windows: D:\foo\bar   -> file:///D:/foo/bar
// (UNC paths \\server\share\... are not specially handled; v1 scope.)
func fileURL(absPath string) string {
	slashed := filepath.ToSlash(absPath)
	if !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	return "file://" + slashed
}

type scanResult struct {
	hasContent bool
	isGitRoot  bool
	mtime      int64
}

// withinEmptyFolderGrace reports whether mtimeMillis falls inside the
// EmptyFolderGraceWindow ending at nowMillis. A zero/negative mtime (stat
// failed) is treated as outside the window so we don't keep folders we know
// nothing about.
func withinEmptyFolderGrace(mtimeMillis, nowMillis int64) bool {
	if mtimeMillis <= 0 {
		return false
	}
	return nowMillis-mtimeMillis < EmptyFolderGraceWindow.Milliseconds()
}

func (s *WorkspaceService) statOnlyPass(parent string, folders []os.DirEntry, out []scanResult) {
	for i, f := range folders {
		sub := filepath.Join(parent, f.Name())
		if info, err := os.Lstat(sub); err == nil {
			out[i].mtime = info.ModTime().UnixMilli()
		}
		// hasContent and isGitRoot stay zero — caller knows via
		// EmptinessUnknown to render all folders without filtering.
	}
}

func (s *WorkspaceService) piggybackScan(parent string, folders []os.DirEntry, out []scanResult, showDotFolders bool) {
	sem := make(chan struct{}, piggybackWorkers)
	var wg sync.WaitGroup
	for i, f := range folders {
		sem <- struct{}{}
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			defer func() { <-sem }()
			sub := filepath.Join(parent, name)
			hc, gr := scanForListing(sub, showDotFolders)
			var mtime int64
			if info, err := os.Lstat(sub); err == nil {
				mtime = info.ModTime().UnixMilli()
			}
			out[i] = scanResult{hasContent: hc, isGitRoot: gr, mtime: mtime}
		}(i, f.Name())
	}
	wg.Wait()
}

// scanForListing performs the per-subfolder peek used by the piggyback. It
// looks for any visible content (under the same filter as ReadDir) AND for a
// .git entry. Stops as soon as both bits are determined. On any I/O error,
// returns hasContent=true so the folder is still rendered (the user can then
// see and act on the permission issue).
//
// showDotFolders mirrors the render filter so the empty-folder rule and the
// visible-listing rule stay in lockstep. When off, a folder containing only
// dot-folders is treated as empty (and therefore hidden).
func scanForListing(path string, showDotFolders bool) (hasContent, isGitRoot bool) {
	f, err := os.Open(path)
	if err != nil {
		return true, false
	}
	defer f.Close()
	for {
		batch, batchErr := f.ReadDir(64)
		for _, e := range batch {
			name := e.Name()
			if name == ".git" {
				isGitRoot = true
			}
			if !hasContent {
				isDir := e.Type().IsDir()
				if strings.HasPrefix(name, ".") {
					// Dotfiles never count. Dot-folders count only when
					// showDotFolders is on; .git is never user content.
					if showDotFolders && isDir && name != ".git" {
						hasContent = true
					}
				} else if isDir {
					hasContent = true
				} else if isMarkdownFile(name) {
					hasContent = true
				}
			}
			if hasContent && isGitRoot {
				return
			}
		}
		if batchErr != nil {
			return
		}
	}
}

func isMarkdownFile(name string) bool {
	lname := strings.ToLower(name)
	return strings.HasSuffix(lname, ".md") ||
		strings.HasSuffix(lname, ".mdx") ||
		strings.HasSuffix(lname, ".markdown")
}

func sortDirEntries(es []os.DirEntry) {
	sort.Slice(es, func(i, j int) bool {
		return strings.ToLower(es[i].Name()) < strings.ToLower(es[j].Name())
	})
}

func (s *WorkspaceService) cacheGitRoot(dir, root string) {
	s.gitMu.Lock()
	s.gitRoots[dir] = root
	s.gitMu.Unlock()
}
