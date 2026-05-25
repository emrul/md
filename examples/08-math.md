# Math (KaTeX)

Inline math uses `$...$`; block (display) math uses `$$...$$`. Each one renders via KaTeX. Click a rendered formula to edit its LaTeX source in place.

## Inline math

Einstein's famous equation: $E = mc^2$. The Pythagorean theorem: $a^2 + b^2 = c^2$. The golden ratio is $\varphi = \frac{1 + \sqrt{5}}{2}$.

You can mix math with prose — the sum of the first $n$ integers is $\frac{n(n+1)}{2}$, and the harmonic number $H_n$ grows like $\ln(n) + \gamma$ as $n \to \infty$.

## Block math

The quadratic formula:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

A definite integral:

$$
\int_0^\infty e^{-x^2}\, dx = \frac{\sqrt{\pi}}{2}
$$

A matrix and a determinant:

$$
\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = ad - bc
$$

Maxwell–Faraday law:

$$
\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
$$

## What to try

- Click any rendered formula — it swaps to an input showing the LaTeX source. Edit, then press **Enter** (inline) or **⌘Enter** (block), or click outside, to commit.
- **Esc** while editing also commits and returns to the rendered view.
- Use `/math` to insert an inline placeholder, or `/mathblock` for a display block.
- Type `$x^2$` followed by a space → auto-converts the run into an inline math atom.
- Save with `⌘S`, reopen — the `$…$` and `$$…$$` source round-trips byte-for-byte.

## Inline tricks

Greek letters: $\alpha, \beta, \gamma, \delta, \pi, \theta, \lambda, \mu, \sigma, \omega$.

Operators and relations: $\sum, \prod, \int, \oint, \leq, \geq, \neq, \approx, \in, \notin, \subset, \cup, \cap$.

Subscripts and superscripts: $x_1, x^2, x_i^j, \int_a^b, \sum_{k=0}^{n}$.

A small expression: $\lim_{x \to 0} \frac{\sin x}{x} = 1$.
