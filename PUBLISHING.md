# Publishing `@vitrina/widget`

The widget is published to **public npm** under the `vitrina` org (scope `@vitrina`),
so any dealer's dev installs it with **no auth**: `npm install @vitrina/widget`.

## First publish (do this once, manually)

Trusted publishing (the CI path below) requires the package to already exist on
npm, so the very first release is a manual publish from your machine:

```bash
# from the repo root, logged in to npm as a member of the `vitrina` org
pnpm --filter @vitrina/widget build      # emits dist/ (index.js, index.d.ts, loader.global.js)
pnpm --filter @vitrina/widget test       # 57 tests, must be green
cd packages/widget
npm publish                              # publishConfig.access=public already set; add --otp=<code> if 2FA
```

Verify: `npm view @vitrina/widget version` → `0.1.0`.

That's all your dev needs — see the package README for the `init()` and `<script>`
embed usage. Nothing else below is required for the Alport demo.

## Automated publishing (later, optional)

`.github/workflows/publish.yml` publishes on a `v*` git tag via **OIDC trusted
publishing** — no npm token in CI (same model as `AtribuCore/atribu-tracker`).
To turn it on, one-time:

1. Push this repo to `github.com/VitrinaDev/vitrina-embed` (it must be **public**
   for provenance; the widget is browser-shipped client code, so public source is fine).
2. On npmjs.com: `@vitrina/widget` → Settings → **Trusted Publisher** → GitHub
   Actions → org `VitrinaDev`, repo `vitrina-embed`, workflow `publish.yml`,
   environment `npm-publish`.
3. In the repo: Settings → **Environments** → create `npm-publish`, restrict to
   `v*` tags (optionally a required reviewer).

Then each release is: bump `packages/widget/package.json` version + CHANGELOG →
commit → `git tag v0.1.1 && git push --tags` → the workflow builds, tests, and
publishes with provenance.

> Note: `publishConfig` intentionally does **not** set `provenance: true` — that
> would break the manual first publish (provenance needs a CI/OIDC environment).
> The CI workflow passes `--provenance` explicitly instead.
