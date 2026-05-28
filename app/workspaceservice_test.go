package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// ageEmpty backdates a folder's mtime well beyond EmptyFolderGraceWindow so
// the empty-folder filter treats it as a long-standing (not just-created)
// folder. Test dirs are made microseconds before the read, which would
// otherwise land inside the grace window.
func ageEmpty(t *testing.T, dir string) {
	t.Helper()
	old := time.Now().Add(-2 * EmptyFolderGraceWindow)
	if err := os.Chtimes(dir, old, old); err != nil {
		t.Fatalf("chtimes %s: %v", dir, err)
	}
}

// build is a tiny helper that creates the given filesystem layout under root.
// Each path ending with "/" creates a directory; otherwise an empty file.
func build(t *testing.T, root string, paths ...string) {
	t.Helper()
	for _, p := range paths {
		full := filepath.Join(root, p)
		if len(p) > 0 && p[len(p)-1] == '/' {
			if err := os.MkdirAll(full, 0o755); err != nil {
				t.Fatalf("mkdir %s: %v", full, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir parent %s: %v", full, err)
		}
		if err := os.WriteFile(full, nil, 0o644); err != nil {
			t.Fatalf("write %s: %v", full, err)
		}
	}
}

func names(es []DirEntry) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.Name
	}
	return out
}

func newSvc(t *testing.T) *WorkspaceService {
	t.Helper()
	return NewWorkspaceService(NewLogService())
}

func TestReadDir_FilterRules(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"keep.md",
		"keep.mdx",
		".hidden.md",
		"notes.txt",
		"image.png",
		".github/",
		".github/README.md",
		"empty-dir/",
		"useful-dir/",
		"useful-dir/index.md",
		"only-dotfile-dir/",
		"only-dotfile-dir/.config",
	)
	// Age the empty folders past the grace window — otherwise the freshly
	// created dirs would be kept as just-made (see EmptyFolderGraceWindow).
	ageEmpty(t, filepath.Join(root, "empty-dir"))
	ageEmpty(t, filepath.Join(root, "only-dotfile-dir"))

	res, err := newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if res.GitRoot != "" {
		t.Errorf("unexpected GitRoot=%q at fresh tempdir", res.GitRoot)
	}

	got := names(res.Entries)
	// showDotFolders=false: `.github` is hidden, even though it has visible
	// content inside. only-dotfile-dir is empty (its only entry is a dotfile,
	// which never counts) → hidden.
	want := []string{"useful-dir", "keep.md", "keep.mdx"}
	if !equal(got, want) {
		t.Errorf("entries:\n got  %v\n want %v", got, want)
	}
}

func TestReadDir_ShowDotFolders(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		".github/",
		".github/README.md",
		"keep.md",
	)

	// showDotFolders=true: dot-folder listed.
	res, err := newSvc(t).ReadDir(root, "", true)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	got := names(res.Entries)
	want := []string{".github", "keep.md"}
	if !equal(got, want) {
		t.Errorf("showDotFolders=true:\n got  %v\n want %v", got, want)
	}

	// showDotFolders=false: dot-folder hidden.
	res, err = newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	got = names(res.Entries)
	want = []string{"keep.md"}
	if !equal(got, want) {
		t.Errorf("showDotFolders=false:\n got  %v\n want %v", got, want)
	}
}

func TestReadDir_GitRootDetectionAndInheritance(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"repo/",
		"repo/.git/",
		"repo/file.md",
		"repo/sub/",
		"repo/sub/nested.md",
		"non-repo/",
		"non-repo/file.md",
	)

	s := newSvc(t)
	res, err := s.ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if res.GitRoot != "" {
		t.Errorf("root itself is not a git root, got %q", res.GitRoot)
	}

	var repo, nonRepo *DirEntry
	for i := range res.Entries {
		switch res.Entries[i].Name {
		case "repo":
			repo = &res.Entries[i]
		case "non-repo":
			nonRepo = &res.Entries[i]
		}
	}
	if repo == nil {
		t.Fatal("'repo' missing from listing")
	}
	if repo.GitRoot != repo.Path {
		t.Errorf("repo.GitRoot=%q, want %q (own path)", repo.GitRoot, repo.Path)
	}
	if nonRepo == nil {
		t.Fatal("'non-repo' missing from listing")
	}
	if nonRepo.GitRoot != "" {
		t.Errorf("non-repo.GitRoot=%q, want empty", nonRepo.GitRoot)
	}

	// Reading inside the repo: parent itself reports its own gitRoot, and
	// children inherit it. .git is not listed.
	repoPath := filepath.Join(root, "repo")
	inside, err := s.ReadDir(repoPath, "", false)
	if err != nil {
		t.Fatalf("ReadDir inside repo: %v", err)
	}
	if inside.GitRoot != repoPath {
		t.Errorf("inside repo: GitRoot=%q, want %q", inside.GitRoot, repoPath)
	}
	for _, e := range inside.Entries {
		if e.Name == ".git" {
			t.Errorf(".git should never appear in listings")
		}
		if e.GitRoot != repoPath {
			t.Errorf("entry %q inherited GitRoot=%q, want %q", e.Name, e.GitRoot, repoPath)
		}
	}

	// Reading a nested folder inside the repo: still inherits via FindGitRoot walk-up.
	subPath := filepath.Join(repoPath, "sub")
	sub, err := s.ReadDir(subPath, "", false)
	if err != nil {
		t.Fatalf("ReadDir inside repo/sub: %v", err)
	}
	if sub.GitRoot != repoPath {
		t.Errorf("repo/sub: GitRoot=%q, want %q", sub.GitRoot, repoPath)
	}
	for _, e := range sub.Entries {
		if e.GitRoot != repoPath {
			t.Errorf("repo/sub entry %q: GitRoot=%q, want %q", e.Name, e.GitRoot, repoPath)
		}
	}
}

func TestFindGitRoot(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"proj/",
		"proj/.git/",
		"proj/a/b/c/",
		"proj/a/b/c/deep.md",
		"out/file.md",
	)
	s := newSvc(t)

	// File deep inside the repo → walk-up finds proj.
	got, err := s.FindGitRoot(filepath.Join(root, "proj/a/b/c/deep.md"))
	if err != nil {
		t.Fatalf("FindGitRoot: %v", err)
	}
	want := filepath.Join(root, "proj")
	if got != want {
		t.Errorf("FindGitRoot deep file: got %q, want %q", got, want)
	}

	// File outside any repo → empty string.
	got, err = s.FindGitRoot(filepath.Join(root, "out/file.md"))
	if err != nil {
		t.Fatalf("FindGitRoot: %v", err)
	}
	if got != "" {
		t.Errorf("FindGitRoot non-repo file: got %q, want \"\"", got)
	}
}

// When showDotFolders is on, a folder containing only a dot-folder DOES
// count as non-empty and is listed. When it's off, the dot-folder doesn't
// count, so the parent is treated as empty and hidden — the two filters
// stay in lockstep so the user never sees a folder that expands to nothing.
func TestReadDir_DotFolderEmptinessAgreesWithRender(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"holder/",
		"holder/.config/",
		"holder/.config/setting.md",
	)
	// Age holder so the showDotFolders=false case tests the empty-filter, not
	// the just-created grace window.
	ageEmpty(t, filepath.Join(root, "holder"))

	// showDotFolders=true: holder is non-empty (its .config dot-folder is content).
	res, err := newSvc(t).ReadDir(root, "", true)
	if err != nil {
		t.Fatalf("ReadDir(true): %v", err)
	}
	if len(res.Entries) != 1 || res.Entries[0].Name != "holder" {
		t.Errorf("showDotFolders=true: holder should be listed; got %v", names(res.Entries))
	}

	// showDotFolders=false: holder is empty (the dot-folder inside doesn't count) → hidden.
	res, err = newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir(false): %v", err)
	}
	if len(res.Entries) != 0 {
		t.Errorf("showDotFolders=false: holder should be hidden (empty); got %v", names(res.Entries))
	}
}

// A just-created empty folder stays visible (grace window) while an
// empty folder older than the window is filtered out. This is what lets the
// frontend create a folder and refetch without the folder vanishing — no
// optimistic-injection workaround needed.
func TestReadDir_EmptyFolderGraceWindow(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"fresh-empty/",
		"old-empty/",
	)
	// fresh-empty keeps its just-now mtime; old-empty is backdated past the window.
	ageEmpty(t, filepath.Join(root, "old-empty"))

	res, err := newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	got := names(res.Entries)
	want := []string{"fresh-empty"}
	if !equal(got, want) {
		t.Errorf("grace window:\n got  %v\n want %v", got, want)
	}
}

// Regression for the sort-vs-piggyback alignment bug: when case-insensitive
// sort reorders folders relative to os.ReadDir's lexicographic order, the
// piggyback results must travel with the folders to the right rows.
//
// os.ReadDir returns 'ZRepo' before 'alpha' (uppercase Z=90 < lowercase a=97).
// Our case-insensitive sort flips them. If we scan in raw order then sort
// without re-aligning, the git-root flag would land on 'alpha' instead of
// 'ZRepo'. This test would have failed against the previous implementation.
func TestReadDir_SortBeforeScanAlignment(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"ZRepo/",
		"ZRepo/.git/",
		"ZRepo/file.md",
		"alpha/",
		"alpha/file.md",
	)

	res, err := newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}

	var zrepo, alpha *DirEntry
	for i := range res.Entries {
		switch res.Entries[i].Name {
		case "ZRepo":
			zrepo = &res.Entries[i]
		case "alpha":
			alpha = &res.Entries[i]
		}
	}
	if zrepo == nil || alpha == nil {
		t.Fatalf("missing entries: %v", names(res.Entries))
	}
	if zrepo.GitRoot != zrepo.Path {
		t.Errorf("ZRepo.GitRoot=%q, want %q (it's the repo)", zrepo.GitRoot, zrepo.Path)
	}
	if alpha.GitRoot != "" {
		t.Errorf("alpha.GitRoot=%q, want \"\" (not a repo)", alpha.GitRoot)
	}
	if alpha.Mtime == 0 {
		t.Errorf("alpha.Mtime should be populated")
	}
	if zrepo.Mtime == 0 {
		t.Errorf("zrepo.Mtime should be populated")
	}
}

func TestReadDir_SortFoldersFirstThenAlpha(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"banana.md",
		"apple.md",
		"Zebra/",
		"Zebra/x.md",
		"alpha/",
		"alpha/x.md",
	)

	res, err := newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	got := names(res.Entries)
	want := []string{"alpha", "Zebra", "apple.md", "banana.md"}
	if !equal(got, want) {
		t.Errorf("sort:\n got  %v\n want %v", got, want)
	}
}

func TestReadDir_MtimePopulated(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"sub/index.md",
	)
	res, err := newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(res.Entries) != 1 || res.Entries[0].Name != "sub" {
		t.Fatalf("unexpected entries: %v", names(res.Entries))
	}
	if res.Entries[0].Mtime == 0 {
		t.Errorf("subfolder Mtime should be populated, got 0")
	}
}

func TestReadDir_ParentMtimePopulated(t *testing.T) {
	root := t.TempDir()
	build(t, root, "sub/index.md")
	res, err := newSvc(t).ReadDir(root, "", false)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if res.ParentMtime == 0 {
		t.Errorf("ParentMtime should be populated, got 0")
	}
}

func TestStatMtimes(t *testing.T) {
	root := t.TempDir()
	build(t, root, "exists.md")

	s := newSvc(t)
	got, err := s.StatMtimes([]string{
		filepath.Join(root, "exists.md"),
		filepath.Join(root, "does-not-exist.md"),
		root,
	})
	if err != nil {
		t.Fatalf("StatMtimes: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("StatMtimes returned %d entries, want 3", len(got))
	}
	if got[0] == 0 {
		t.Errorf("existing file mtime should be non-zero")
	}
	if got[1] != 0 {
		t.Errorf("non-existent path mtime should be 0, got %d", got[1])
	}
	if got[2] == 0 {
		t.Errorf("existing dir mtime should be non-zero")
	}
}

func TestFindGitRoot_CacheShortCircuit(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"proj/",
		"proj/.git/",
		"proj/a/b/c/deep.md",
	)
	s := newSvc(t)

	// Prime the cache: walk-up from proj/a finds proj.
	_, _ = s.FindGitRoot(filepath.Join(root, "proj/a"))

	// Now query deep — should hit cache mid-walk-up at proj/a (or earlier
	// for its descendants we cache too). We can't directly observe syscall
	// counts here, but we can verify correctness AND that the deeper
	// query's intermediates are also cached after.
	got, err := s.FindGitRoot(filepath.Join(root, "proj/a/b/c/deep.md"))
	if err != nil {
		t.Fatalf("FindGitRoot: %v", err)
	}
	wantRoot := filepath.Join(root, "proj")
	if got != wantRoot {
		t.Errorf("deep query: got %q, want %q", got, wantRoot)
	}

	// Verify all intermediates are now in the cache by removing the .git
	// dir and querying again — should still return cached answer.
	if err := os.RemoveAll(filepath.Join(root, "proj/.git")); err != nil {
		t.Fatalf("remove .git: %v", err)
	}
	got, err = s.FindGitRoot(filepath.Join(root, "proj/a/b/c/deep.md"))
	if err != nil {
		t.Fatalf("FindGitRoot (post-removal): %v", err)
	}
	if got != wantRoot {
		t.Errorf("cache miss after .git removal — walk-up cache not populated at each step")
	}
}

func TestFileURL(t *testing.T) {
	// Use the helper directly so we can test Windows-style paths even on Mac.
	cases := []struct {
		in   string
		want string
	}{
		{"/foo/bar", "file:///foo/bar"},
		{"/Users/emrul/notes/api.md", "file:///Users/emrul/notes/api.md"},
		// Simulated Windows path after ToSlash (drive letter, no leading slash).
		// fileURL is called with the OS-native path; on Mac filepath.ToSlash
		// won't convert backslashes, so we test the post-ToSlash shape directly
		// by giving it an already-slashed Windows-like path.
		{"D:/notes/api.md", "file:///D:/notes/api.md"},
		{"C:/foo/bar baz.md", "file:///C:/foo/bar baz.md"},
	}
	for _, c := range cases {
		got := fileURL(c.in)
		if got != c.want {
			t.Errorf("fileURL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestContextualRoot(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"proj/",
		"proj/.git/",
		"proj/docs/api.md",
		"loose/notes.md",
	)
	s := newSvc(t)

	// Untitled → home dir.
	home, _ := os.UserHomeDir()
	got, err := s.ContextualRoot("")
	if err != nil {
		t.Fatalf("ContextualRoot(empty): %v", err)
	}
	if got != home {
		t.Errorf("untitled: got %q, want home %q", got, home)
	}

	// File in a git repo → repo root, not file's parent dir.
	got, err = s.ContextualRoot(filepath.Join(root, "proj/docs/api.md"))
	if err != nil {
		t.Fatalf("ContextualRoot(in-repo): %v", err)
	}
	wantRepo := filepath.Join(root, "proj")
	if got != wantRepo {
		t.Errorf("in-repo: got %q, want %q", got, wantRepo)
	}

	// File outside any repo → file's parent dir.
	got, err = s.ContextualRoot(filepath.Join(root, "loose/notes.md"))
	if err != nil {
		t.Fatalf("ContextualRoot(loose): %v", err)
	}
	wantDir := filepath.Join(root, "loose")
	if got != wantDir {
		t.Errorf("loose: got %q, want %q", got, wantDir)
	}
}

func TestParentDir(t *testing.T) {
	s := newSvc(t)

	got, err := s.ParentDir("/a/b/c")
	if err != nil {
		t.Fatalf("ParentDir: %v", err)
	}
	if got != "/a/b" {
		t.Errorf("/a/b/c → got %q, want %q", got, "/a/b")
	}

	got, _ = s.ParentDir("/foo")
	if got != "/" {
		t.Errorf("/foo → got %q, want %q", got, "/")
	}

	// At FS root, ParentDir is idempotent — the disabled-state signal.
	got, _ = s.ParentDir("/")
	if got != "/" {
		t.Errorf("/ → got %q, want %q (idempotent at root)", got, "/")
	}

	if _, err := s.ParentDir(""); err == nil {
		t.Errorf("expected error on empty path")
	}
}

func TestChildLinksForFolder(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"docs/api.md",
		"docs/auth.md",
		"docs/notes.txt",   // non-md, filtered
		"docs/.hidden.md",  // dotfile, filtered
		"docs/subdir/",     // folder, filtered (only files)
		"docs/subdir/x.md", // ignored — non-recursive
		"src/spec.md",      // outside the folder
	)
	s := newSvc(t)

	// fromFile = src/spec.md, folder = docs/ → relative paths like ../docs/...
	from := filepath.Join(root, "src/spec.md")
	folder := filepath.Join(root, "docs")
	got, err := s.ChildLinksForFolder(folder, from)
	if err != nil {
		t.Fatalf("ChildLinksForFolder: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 children, got %d: %+v", len(got), got)
	}
	if got[0].Name != "api" || got[1].Name != "auth" {
		t.Errorf("names not sorted alpha: %+v", got)
	}
	if got[0].Href != "../docs/api.md" {
		t.Errorf("api href = %q, want %q", got[0].Href, "../docs/api.md")
	}
	if got[1].Href != "../docs/auth.md" {
		t.Errorf("auth href = %q, want %q", got[1].Href, "../docs/auth.md")
	}
}

func TestRelativeLinkPath(t *testing.T) {
	root := t.TempDir()
	build(t, root,
		"a/spec.md",
		"a/api.md",
		"b/baz.md",
	)
	s := newSvc(t)

	got, _ := s.RelativeLinkPath(filepath.Join(root, "a/spec.md"), filepath.Join(root, "a/api.md"))
	if got != "./api.md" {
		t.Errorf("same-dir: got %q, want %q", got, "./api.md")
	}

	got, _ = s.RelativeLinkPath(filepath.Join(root, "a/spec.md"), filepath.Join(root, "b/baz.md"))
	if got != "../b/baz.md" {
		t.Errorf("sibling-dir: got %q, want %q", got, "../b/baz.md")
	}

	// Untitled source → file:// URL.
	got, _ = s.RelativeLinkPath("", filepath.Join(root, "a/api.md"))
	if got != "file://"+filepath.ToSlash(filepath.Join(root, "a/api.md")) {
		t.Errorf("untitled: got %q", got)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
