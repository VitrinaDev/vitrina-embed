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

## Automated publishing (OIDC — removes the 2FA/OTP prompt)

`.github/workflows/publish.yml` publishes on a `v*` git tag via **OIDC trusted
publishing** — no npm token, and **no `--otp` one-time password** (the workflow
exchanges its `id-token` for a short-lived npm credential). Same model as
`AtribuCore/atribu-tracker`, plus a tag↔version guard and a test gate.

Setup status:

- [x] Repo pushed to `github.com/VitrinaDev/vitrina-embed` and made **public**
      (provenance requires it; the widget is browser-shipped client code).
- [x] Repo → Settings → **Environments** → `npm-publish`, restricted to `v*` **tags**.
- [ ] **On npmjs.com (only an org owner can do this):** `@vitrina/widget` →
      Settings → **Trusted Publisher** → GitHub Actions →
      organization `VitrinaDev`, repository `vitrina-embed`,
      workflow `publish.yml`, environment `npm-publish`.

Once that last box is ticked, every release is:

```bash
# bump packages/widget/package.json version (+ CHANGELOG), commit, then:
git tag v0.1.2 && git push origin v0.1.2
```

The workflow verifies the tag matches `package.json`, installs, builds, runs the
test suite, and publishes with provenance. A mismatched tag fails loudly instead
of silently republishing the previous version.

> The first publish (0.1.0) and the 0.1.1 fix were published manually, so they
> carry no provenance attestation. Tagged releases from here on will.

> Note: `publishConfig` intentionally does **not** set `provenance: true` — that
> would break the manual first publish (provenance needs a CI/OIDC environment).
> The CI workflow passes `--provenance` explicitly instead.
