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

Build from `website` and publish `website/dist` using any static host. For a canonical domain, set `SITE_URL` when building. For subdirectory hosting, also set `BASE_PATH`:

```sh
SITE_URL=https://fil1994.github.io BASE_PATH=/pi-model-hotkeys bun run build
```

Root hosting uses `/` by default. No deployment workflow or hosting account is required for local development.
