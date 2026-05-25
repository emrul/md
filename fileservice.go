package main

import (
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type FileService struct {
	window *application.WebviewWindow
}

func (f *FileService) OpenFileDialog() (string, error) {
	d := application.Get().Dialog.OpenFile().
		SetTitle("Open Markdown File").
		AddFilter("Markdown Files", "*.md;*.markdown").
		AddFilter("Text Files", "*.txt")
	if f.window != nil {
		d = d.AttachToWindow(f.window)
	}
	return d.PromptForSingleSelection()
}

func (f *FileService) SaveFileDialog(currentName string) (string, error) {
	if currentName == "" {
		currentName = "Untitled.md"
	}
	d := application.Get().Dialog.SaveFile().
		AddFilter("Markdown Files", "*.md").
		SetFilename(filepath.Base(currentName))
	if f.window != nil {
		d = d.AttachToWindow(f.window)
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

func (f *FileService) SetWindowTitle(title string) {
	if f.window != nil {
		f.window.SetTitle(title)
	}
}
