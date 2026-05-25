// Empty stub. The Wails runtime probes /wails/custom.js with a HEAD request
// (loadOptionalScript) and, in Vite dev mode, the SPA fallback would otherwise
// return index.html with a 200 status — the runtime then injects a <script>
// tag for /wails/custom.js, the browser fetches HTML, and tries to parse it
// as JS, producing "SyntaxError: Unexpected token '<'". Serving an empty real
// JS file at this path stops the runtime from doing that.
