package app

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

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
