package app

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func imageRequest(path string) *http.Request {
	return httptest.NewRequest(
		http.MethodGet,
		"/image?path="+url.QueryEscape(filepath.ToSlash(path)),
		nil,
	)
}

func TestFileServiceServeHTTPImage(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "screenshot.png")
	if err := os.WriteFile(path, []byte("png"), 0o644); err != nil {
		t.Fatalf("write image: %v", err)
	}

	res := httptest.NewRecorder()
	(&FileService{}).ServeHTTP(res, imageRequest(path))

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%q", res.Code, http.StatusOK, res.Body.String())
	}
	if got := res.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	if got := res.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := res.Header().Get("Content-Type"); !strings.HasPrefix(got, "image/png") {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
}

func TestFileServiceServeHTTPRejectsNonImages(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "notes.md")
	if err := os.WriteFile(path, []byte("# Notes"), 0o644); err != nil {
		t.Fatalf("write text file: %v", err)
	}

	res := httptest.NewRecorder()
	(&FileService{}).ServeHTTP(res, imageRequest(path))

	if res.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusUnsupportedMediaType)
	}
}

func TestFileServiceServeHTTPRequiresAbsoluteImagePath(t *testing.T) {
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/image?path=relative.png", nil)
	(&FileService{}).ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusBadRequest)
	}
}

func TestFileServiceServeHTTPRejectsUnsupportedMethod(t *testing.T) {
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/image?path=/tmp/image.png", nil)
	(&FileService{}).ServeHTTP(res, req)

	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusMethodNotAllowed)
	}
	if got := res.Header().Get("Allow"); got != "GET, HEAD" {
		t.Errorf("Allow = %q, want GET, HEAD", got)
	}
}
