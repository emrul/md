package app

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type FileService struct{}

// previewHeadBytes bounds how much of a file PreviewFile reads. The explorer's
// hover preview only shows a heading + first few lines, which live in the
// head; reading more would waste IO/IPC on large files for no visible gain.
const previewHeadBytes = 8192

// OpenFileDialog returns a slice of selected paths. The user may pick one or
// many files; an empty slice means they canceled.
func (f *FileService) OpenFileDialog() ([]string, error) {
	d := application.Get().Dialog.OpenFile().
		SetTitle("Open Markdown File").
		AddFilter("Markdown Files", "*.md;*.markdown;*.mdx").
		AddFilter("Text Files", "*.txt")
	if w := application.Get().Window.Current(); w != nil {
		d = d.AttachToWindow(w)
	}
	return d.PromptForMultipleSelection()
}

func (f *FileService) SaveFileDialog(currentName string) (string, error) {
	if currentName == "" {
		currentName = "Untitled.md"
	}
	d := application.Get().Dialog.SaveFile().
		AddFilter("Markdown Files", "*.md").
		SetFilename(filepath.Base(currentName))
	if w := application.Get().Window.Current(); w != nil {
		d = d.AttachToWindow(w)
	}
	return d.PromptForSingleSelection()
}

func (f *FileService) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// FileStat is the cheap "did this file change?" signal the frontend polls open
// documents with, so it only re-reads (and diffs) a file whose stat actually
// moved. Content is still the source of truth — this is just the gate.
type FileStat struct {
	// ModTimeMs is the file's modification time in milliseconds since the epoch.
	ModTimeMs int64 `json:"modTimeMs"`
	// Size is the file size in bytes.
	Size int64 `json:"size"`
}

// StatFile returns the modification time + size of the file at path. A missing
// file surfaces os.ErrNotExist, which the frontend treats as "deleted on disk".
func (f *FileService) StatFile(path string) (FileStat, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return FileStat{}, err
	}
	return FileStat{ModTimeMs: fi.ModTime().UnixMilli(), Size: fi.Size()}, nil
}

func (f *FileService) WriteFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

// PreviewFile returns up to previewHeadBytes from the head of the file, for
// the explorer's hover preview. It never reads the whole file: one bounded
// read into a fixed buffer keeps hovering a huge file as cheap as hovering a
// small one. Truncation mid-line is fine — the caller only renders a heading
// plus the first few lines.
func (f *FileService) PreviewFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	buf := make([]byte, previewHeadBytes)
	n, err := io.ReadFull(file, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", err
	}
	return string(buf[:n]), nil
}

func isDisplayableImage(path string) bool {
	mimeType := strings.ToLower(mime.TypeByExtension(filepath.Ext(path)))
	return strings.HasPrefix(mimeType, "image/")
}

// ServeHTTP exposes local document images to the WebView through the app's own
// asset origin. Desktop webviews commonly refuse file:// subresources from the
// bundled app page, so rendered markdown images use this narrow endpoint.
func (f *FileService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/image" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rawPath := r.URL.Query().Get("path")
	if rawPath == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}
	path := filepath.Clean(filepath.FromSlash(rawPath))
	if !filepath.IsAbs(path) {
		http.Error(w, "absolute path required", http.StatusBadRequest)
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if !isDisplayableImage(path) {
		http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
		return
	}

	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, path)
}

// RevealInFinder shows the file in the OS file browser, selected.
// macOS: `open -R`; Windows: `explorer /select,`; Linux: opens parent dir
// (most desktop environments lack a portable "reveal this file" command).
func (f *FileService) RevealInFinder(path string) error {
	if path == "" {
		return errors.New("path required")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		cmd = exec.Command("explorer", "/select,"+path)
	case "linux":
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	default:
		return errors.New("unsupported platform")
	}
	return cmd.Start()
}

// RenameFile renames the file at oldPath to newName in the SAME directory.
// Returns the new full path. Refuses path separators in newName so a stray
// "../" can't accidentally move the file out of its directory — use Save As
// for that.
func (f *FileService) RenameFile(oldPath, newName string) (string, error) {
	if oldPath == "" || newName == "" {
		return "", errors.New("oldPath and newName required")
	}
	if newName != filepath.Base(newName) {
		return "", errors.New("name cannot contain path separators")
	}
	dir := filepath.Dir(oldPath)
	newPath := filepath.Join(dir, newName)
	if oldPath == newPath {
		return newPath, nil
	}
	if _, err := os.Stat(newPath); err == nil {
		return "", errors.New("a file with that name already exists")
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return "", err
	}
	return newPath, nil
}
