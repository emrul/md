# md

I loved [MarkText](https://github.com/marktext/marktext) (especially the hybrid WYSIWYG / source editing) and [Typora](https://typora.io). I worked with Claude to design and build something like it on more modern foundations ([TipTap](https://tiptap.dev) + [Wails 3](https://v3.wails.io)).

Early days — see [`../md-pro/docs/design.md`](../md-pro/docs/design.md) for the milestone plan.

## Develop

```
wails3 dev
```

## Build

```
wails3 task darwin:package           # macOS .app in bin/
wails3 task darwin:package:universal # universal binary
wails3 task windows:package          # Windows .exe
```

## License

MIT — see [LICENSE](LICENSE).
