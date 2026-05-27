package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// buildAppMenu constructs the native application menu. Every non-role item
// emits a "command" event carrying the command-registry ID, so the frontend
// stays the single source of truth for what each action does.
func buildAppMenu(app *application.App) *application.Menu {
	menu := app.NewMenu()

	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}

	file := menu.AddSubmenu("File")
	addCmd(app, file, "New", "CmdOrCtrl+n", "file.new")
	addCmd(app, file, "New Window", "CmdOrCtrl+Shift+n", "window.newEmpty")
	addCmd(app, file, "Open…", "CmdOrCtrl+o", "file.open")
	file.AddSeparator()
	addCmd(app, file, "Save", "CmdOrCtrl+s", "file.save")
	addCmd(app, file, "Save As…", "CmdOrCtrl+Shift+s", "file.saveAs")
	file.AddSeparator()
	addCmd(app, file, "Close Tab", "CmdOrCtrl+w", "tab.close")

	edit := menu.AddSubmenu("Edit")
	addCmd(app, edit, "Undo", "CmdOrCtrl+z", "edit.undo")
	addCmd(app, edit, "Redo", "CmdOrCtrl+Shift+z", "edit.redo")
	edit.AddSeparator()
	edit.AddRole(application.Cut)
	edit.AddRole(application.Copy)
	edit.AddRole(application.Paste)
	edit.AddSeparator()
	edit.AddRole(application.SelectAll)

	format := menu.AddSubmenu("Format")
	addCmd(app, format, "Bold", "CmdOrCtrl+b", "format.bold")
	addCmd(app, format, "Italic", "CmdOrCtrl+i", "format.italic")
	addCmd(app, format, "Strikethrough", "", "format.strike")
	addCmd(app, format, "Inline Code", "CmdOrCtrl+e", "format.code")
	format.AddSeparator()
	addCmd(app, format, "Heading 1", "CmdOrCtrl+OptionOrAlt+1", "format.heading1")
	addCmd(app, format, "Heading 2", "CmdOrCtrl+OptionOrAlt+2", "format.heading2")
	addCmd(app, format, "Heading 3", "CmdOrCtrl+OptionOrAlt+3", "format.heading3")
	format.AddSeparator()
	addCmd(app, format, "Bullet List", "CmdOrCtrl+Shift+8", "format.bulletList")
	addCmd(app, format, "Ordered List", "CmdOrCtrl+Shift+7", "format.orderedList")
	addCmd(app, format, "Task List", "CmdOrCtrl+Shift+9", "format.taskList")
	format.AddSeparator()
	addCmd(app, format, "Blockquote", "CmdOrCtrl+Shift+b", "format.blockquote")
	addCmd(app, format, "Code Block", "CmdOrCtrl+Shift+k", "format.codeBlock")
	addCmd(app, format, "Horizontal Rule", "", "format.horizontalRule")
	format.AddSeparator()
	addCmd(app, format, "Link…", "CmdOrCtrl+k", "insert.link")
	addCmd(app, format, "Image…", "", "insert.image")
	format.AddSeparator()
	addCmd(app, format, "Clear Formatting", "", "format.clearAll")

	view := menu.AddSubmenu("View")
	addCmd(app, view, "Toggle Source View", "CmdOrCtrl+/", "view.toggleSource")

	if runtime.GOOS == "darwin" {
		menu.AddRole(application.WindowMenu)
		menu.AddRole(application.HelpMenu)
	}

	return menu
}

// registerTabContextMenu attaches the right-click menus used by tab strip
// entries. Each menu item emits a window-scoped event whose data payload is
// the tab id (set via the --custom-contextmenu-data CSS variable on the tab
// element). The frontend filters by event.sender so the action stays in the
// window where the right-click happened.
//
// Two variants are registered because Wails 3 menus can't be reconfigured per
// right-click: "tab-saved" for tabs backed by a file on disk, "tab-untitled"
// for unsaved Untitled tabs (no Show in Finder). The tab strip picks the
// right name via --custom-contextmenu.
func registerTabContextMenu(app *application.App) {
	addCommonTabItems := func(m *application.Menu) {
		m.Add("Close Tab").SetAccelerator("CmdOrCtrl+w").OnClick(emitToCurrentWindow(app, "tab:close"))
		m.Add("Close Other Tabs").OnClick(emitToCurrentWindow(app, "tab:closeOthers"))
		m.Add("Close Tabs to the Right").OnClick(emitToCurrentWindow(app, "tab:closeRight"))
		m.AddSeparator()
		m.Add("Open in New Window").OnClick(emitToCurrentWindow(app, "tab:openInNewWindow"))
		m.AddSeparator()
		m.Add("Copy Filename").OnClick(emitToCurrentWindow(app, "tab:copyFileName"))
	}

	saved := app.ContextMenu.New()
	addCommonTabItems(saved.Menu)
	revealLabel := "Show in Finder"
	if runtime.GOOS != "darwin" {
		revealLabel = "Show in Explorer"
	}
	saved.Menu.Add(revealLabel).OnClick(emitToCurrentWindow(app, "tab:revealInExplorer"))
	app.ContextMenu.Add("tab-saved", saved)

	untitled := app.ContextMenu.New()
	addCommonTabItems(untitled.Menu)
	app.ContextMenu.Add("tab-untitled", untitled)
}

func emitToCurrentWindow(app *application.App, name string) func(*application.Context) {
	return func(ctx *application.Context) {
		win := app.Window.Current()
		if win == nil {
			app.Event.Emit(name, ctx.ContextMenuData())
			return
		}
		win.EmitEvent(name, ctx.ContextMenuData())
	}
}

func addCmd(app *application.App, m *application.Menu, label, accel, id string) {
	item := m.Add(label).OnClick(func(ctx *application.Context) {
		app.Event.Emit("command", id)
	})
	if accel != "" {
		item.SetAccelerator(accel)
	}
}
