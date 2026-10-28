# Design ticket flow

Every **design ticket** in Linear tracks gallery work from exploration through QA. Each design ticket has a **developer counterpart ticket** that stays blocked until the design ticket reaches **Done**. When the design ticket completes, it unblocks the developer ticket so implementation can proceed against the approved spec and gallery components.

The **spec directory (`specs/`) is designer-only.** See [Who edits what](./component-gallery.md#who-edits-what) in the component gallery doc for who may edit specs versus gallery components.

## Statuses

Statuses below match Linear exactly. Move tickets through them in order unless your team agrees otherwise on a given ticket.

| #   | Status                              | Who acts | What happens                                                                                               |
| --- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Ready to explore design             | Designer | Waiting for Designer                                                                                       |
| 2   | In design exploration               | Designer | MagicPath iterations with Diadem                                                                           |
| 3   | Ready for maintainer                | Diadem   | Design approval (reused status; the only Diadem approval)                                                  |
| 4   | Ready for design dev                | Designer | Spec PR (spec directory only) merged; QA merges on green CI                                                |
| 5   | In design dev                       | Designer | Builds or updates gallery components from the spec                                                         |
| 6   | Ready for review, then In QA Review | QA       | QA checks gallery components match the approved spec                                                       |
| 7   | Done                                | none     | Unblocks the developer counterpart ticket; Designer adds the Spec section (merge commit, file paths) to it |

Row 6 is two Linear statuses in sequence: **Ready for review**, then **In QA Review**.

Related: [component gallery](./component-gallery.md) directories, local dev, and previews. Decision record: [ADR 0004](./decisions/0004-component-gallery.md).
