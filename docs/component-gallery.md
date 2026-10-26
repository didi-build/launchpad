# Component gallery

Every Launchpad-derived repo includes a **component gallery**: a `/gallery` route on the Cloudflare Worker preview that renders each registered component with its variants and props. Use it while implementing UI from approved specs and while reviewing PRs.

## Who edits what

| Role          | `specs/` (design specs)                                                                                       | `components/` (gallery implementations)                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Designer**  | Create and update specs after Diadem approves direction. Build or update gallery components from those specs. | Yes                                                                                                         |
| **Developer** | No edits                                                                                                      | Yes, only for non-design changes: extra props, wiring, accessibility fixes that do not change visual design |
| **QA**        | Read specs                                                                                                    | Verify gallery components match the approved spec (no second Diadem approval on components)                 |

The **spec directory is designer-only.** Developers wire components from the gallery into `src/` (or your app tree) and do not change specs.

## Directories

| Path          | Purpose                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `specs/`      | Markdown (or similar) design specs, one file per component                  |
| `components/` | Gallery components and `*.gallery.ts` metadata (variants, props, spec link) |
| `gallery/`    | Gallery SPA (registry, layout, styles); not the app under `src/`            |

## Add a component

1. Add an approved spec under `specs/<name>.md`.
2. Implement the component under `components/<name>/`.
3. Add `<name>.gallery.ts` exporting a `GalleryEntry` (see `components/example-button/example-button.gallery.ts`).
4. Register it in `gallery/registry.ts`.
5. Run `npm run build` and open `/gallery` locally with `npm run dev:gallery` or on a PR preview.

## Local development

```bash
npm install
npm run dev:gallery   # Vite dev server with /gallery
npm run build         # Production asset build (also runs in npm run check)
```

PRs on `didi-build/launchpad` (and derived repos with Cloudflare secrets configured) get a **gallery preview** comment from CI with a link to `/gallery`.

See [ADR 0004](./decisions/0004-component-gallery.md) for hosting and preview choices.
