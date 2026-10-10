# Pinned GitHub Action SHAs

Launchpad workflows pin actions to full commit SHAs with a `# vX.Y.Z` comment. Verify a pin with:

```bash
gh api "repos/{owner}/{repo}/git/ref/tags/vX.Y.Z" --jq '.object.sha'
```

The resolved SHA must equal the pin (for annotated tags, resolve the tag object to its commit first).

## CI (`.github/workflows/ci.yml`)

| Action                                 | Pin (SHA)                                  | Comment | Resolves to                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/checkout`                     | `11bd71901bbe5b1630ceea73d27597364c9af683` | v4.2.2  | Tag `v4.2.2` → commit `11bd71901bbe5b1630ceea73d27597364c9af683`                                                                                                                                                |
| `actions/setup-node`                   | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0  | Tag `v4.4.0` → commit `49933ea5288caeca8642d1e84afbd3f7d6820020`                                                                                                                                                |
| `dorny/test-reporter`                  | `fe45e9537387dac839af0d33ba56eed8e24189e8` | v2.3.0  | Tag `v2.3.0` is an **annotated tag** at `06b4484c17d304ad4a41a84c844c2ee967535ce2`; that tag points to commit **`fe45e9537387dac839af0d33ba56eed8e24189e8`** (the release tree). Do not pin the tag object SHA. |
| `peter-evans/find-comment`             | `b30e6a3c0ed37e7c023ccd3f1db5c6c0b0c23aad` | v4.0.0  | Tag `v4.0.0` → commit `b30e6a3c0ed37e7c023ccd3f1db5c6c0b0c23aad`                                                                                                                                                |
| `peter-evans/create-or-update-comment` | `e8674b075228eee787fea43ef493e45ece1004c9` | v5.0.0  | Tag `v5.0.0` → commit `e8674b075228eee787fea43ef493e45ece1004c9`                                                                                                                                                |

## Dependabot auto-merge (`.github/workflows/dependabot-automerge.yml`)

| Action                      | Pin (SHA)                               | Comment | Resolves to                                                   |
| --------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------- |
| `dependabot/fetch-metadata` | `25dd0e34f4fe68f24cc83900b1fe149efef98` | v3.1.0  | Tag `v3.1.0` → commit `25dd0e34f4fe68f24cc83900b1fe149efef98` |

## One-liner check (2026-10-10)

```bash
for spec in \
  "actions/checkout:11bd71901bbe5b1630ceea73d27597364c9af683:v4.2.2" \
  "actions/setup-node:49933ea5288caeca8642d1e84afbd3f7d6820020:v4.4.0" \
  "dorny/test-reporter:fe45e9537387dac839af0d33ba56eed8e24189e8:v2.3.0" \
  "peter-evans/find-comment:b30e6a3c0ed37e7c023ccd3f1db5c6c0b0c23aad:v4.0.0" \
  "peter-evans/create-or-update-comment:e8674b075228eee787fea43ef493e45ece1004c9:v5.0.0" \
  "dependabot/fetch-metadata:25dd0e34f4fe68f24cc83900b1fe149efef98:v3.1.0"
do
  IFS=: read -r name want tag <<<"$spec"
  got=$(gh api "repos/${name}/git/ref/tags/${tag}" --jq '.object.sha' 2>/dev/null || true)
  if [ "$name" = "dorny/test-reporter" ]; then
    got=$(gh api "repos/${name}/git/tags/${got}" --jq '.object.sha' 2>/dev/null || echo "$got")
  fi
  if [ "$got" = "$want" ]; then echo "OK $name $tag"; else echo "MISMATCH $name $tag (got $got want $want)"; fi
done
```
