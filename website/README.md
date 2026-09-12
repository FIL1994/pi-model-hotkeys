# Documentation website

Astro + Starlight documentation with Tailwind CSS 4 and a custom landing page.
Requires Node.js 22.12+ (Node.js 24 recommended) and Bun.

```sh
cd website
bun install
bun run dev
```

The development server runs at `http://localhost:4321`.

```sh
bun run check   # Astro and TypeScript diagnostics
bun run build   # Check, then generate the static site and search index
bun run preview
```

## Structure

- `src/pages/index.astro` — custom responsive landing page
- `src/content/docs/` — Markdown documentation
- `src/styles/custom.css` — Tailwind imports and Starlight theme
- `astro.config.mjs` — navigation, metadata, and deployment settings

The landing page and docs share one dark-and-lime theme, independent of system preferences or previously saved Starlight themes. Shared palette tokens live in `src/styles/custom.css`; component overrides keep Starlight in dark mode without a theme selector.

Starlight includes mobile navigation, page outlines, code-copy buttons, and Pagefind search. Search is generated during production builds; use `bun run preview` to test it.

## Deploy

The repository deploys the website to GitHub Pages through
`.github/workflows/deploy-docs.yml` whenever changes under `website` land on
`main`. Enable **Settings → Pages → Build and deployment → Source: GitHub
Actions** once in the repository settings.

The published site is:

<https://fil1994.github.io/pi-model-hotkeys/>

To build locally, set `SITE_URL` for the canonical domain and `BASE_PATH` for
the repository subdirectory:

```sh
SITE_URL=https://fil1994.github.io BASE_PATH=/pi-model-hotkeys bun run build
```

Root hosting uses `/` by default.
