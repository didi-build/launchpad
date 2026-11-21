# Component gallery

Every Launchpad-derived repo includes a **component gallery**: a page at `/gallery`, beside the project's landing page at `/`, that renders each registered component with its variants and props. Use it while implementing UI from approved specs and while reviewing PRs.

## Who edits what

| Role          | `design/` (spec files under `design/<area>/<feature>/`) | `components/` (gallery implementations)                                                     |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Designer**  | Create and update specs (Diadem approves them).         | Build or update gallery components from the spec after Diadem approves it.                  |
| **Developer** | No edits                                                | Yes, only for non-design changes: props or tiny non-design wiring fixes                     |
| **QA**        | Read specs                                              | Verify gallery components match the approved spec (no second Diadem approval on components) |

The **`design/` tree is designer-only.** Developers wire components from the gallery into `src/` (or your app tree) and do not change specs.

For Linear status names and handoffs (design ticket, developer counterpart, Diadem approval, QA), see [Design ticket flow](./design-workflow.md).

## Directories

| Path                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `design/<area>/<feature>/` | Design specs (`spec.md` per feature); index in [design/README.md](../design/README.md)  |
| `components/`              | Gallery components and `*.gallery.ts` metadata (variants, props, spec link)             |
| `gallery/`                 | Gallery app at `/gallery` (`gallery/index.html`, registry, layout, styles); not the app |

Gallery metadata may import spec markdown at build time for display; specs remain designer-only at edit time.

## Add a component

1. Add an approved spec at `design/<area>/<feature>/spec.md` and list it in `design/README.md`.
2. Implement the component under `components/<name>/`.
3. Add `<name>.gallery.ts` exporting a `GalleryEntry` (see `components/example-button/example-button.gallery.ts`).
4. Register it in `gallery/registry.ts`.
5. Run `npm run build` and open `/gallery/` locally with `npm run dev:gallery`.

## Local development

```bash
npm install
npm run dev:gallery   # Vite dev server: the landing page at /, the gallery at /gallery/
npm run build         # Production asset build into dist/site (also runs in npm run check)
```

Pull requests get no hosted preview (Foreman's D-446). CI's `preview-check` job builds the site on CI's own machine, serves it on 127.0.0.1 and checks that the gallery loads and serves the head commit; see the [deploy runbook](./runbooks/deploy.md).

See [ADR 0004](./decisions/0004-component-gallery.md) for hosting choices and [ADR 0007](./decisions/0007-worker-backend-and-staging-build.md) for the landing page and the Worker beside the gallery. [ADR 0005](./decisions/0005-preview-worker-isolation.md) (preview Worker isolation) is superseded.
