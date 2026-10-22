# Viewer on Cloudflare Pages

The `viewer` GitHub Actions workflow builds and checks the public viewer on pull
requests. A push to `master` affecting `web/` or `deploy/` also deploys it to the
existing Cloudflare Pages project `peekaview`, served at https://peekaview.de.
It can also be run manually on `master` from GitHub Actions.

Cloudflare's production branch must be `master`. The existing custom domain
`peekaview.de` points to `peekaview.pages.dev`; no DNS changes are needed.

The repository's Actions secrets provide `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. The token needs **Account → Cloudflare Pages → Edit**
for the account containing this project. Keep credentials in secrets or local
environment variables, never in this directory. Pull request checks receive no
Cloudflare credentials and do not deploy.

With the pnpm version declared in `package.json`:

```sh
cd deploy
pnpm install --frozen-lockfile
pnpm test
```

`pnpm build` copies an explicit list of public viewer modules and licenses into
`dist/`. Desktop pages and repository files are excluded. `_headers` makes browsers
revalidate assets so HTML and modules stay in sync after a release.

For an authenticated manual production deployment, set the two Cloudflare
environment variables and run `pnpm deploy`. The CI uses the same Pages command
and attaches the GitHub commit SHA to the deployment.

To use this hosted viewer for invitations, set **Zuschauer-Website** in the
presenter app to `https://peekaview.de`.
