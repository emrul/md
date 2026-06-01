# Code & math

## Inline code

Wrap snippets in backticks: call `editor.setEditable(false)` to lock a buffer, or reference a file like `frontend/src/app/tab.ts`.

## Fenced code blocks

Fence a block with triple backticks and a language for syntax highlighting:

```ts
function greet(name: string): string {
  return `Hello, ${name}!`
}

console.log(greet('MarkdownMD'))
```

```python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```bash
# Build and run
wails3 task dev
```

## Math

Inline math uses single dollars: the mass–energy relation $E = mc^2$ sits right in the sentence.

Block math uses double dollars and renders centered:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
\frac{\partial}{\partial t}\,\Psi(\mathbf{r}, t) = \frac{i\hbar}{2m}\nabla^2 \Psi - \frac{i}{\hbar} V \Psi
$$

Math is rendered with KaTeX, so it stays crisp at any zoom.
