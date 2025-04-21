# build-logs

Making build logs from [lilac](https://github.com/archlinuxcn/lilac) public using [Cloudflare Workers](https://workers.cloudflare.com/)

## Feature Overview

### Static Resources and HTML Page Loading

- `/` : Returns the homepage `logs.html`
- `/current/` : Returns `current.html`
- `/static/...` : Returns front-end static resources (CSS, JS, etc.)
- `/images/...` : Returns image resources

### API Routes (starting with `/imlonghao-api/`)

- `/status` : Returns the latest `batch` data
- `/current` : Returns the current package status from the `pkgcurrent` table
- `/logs` : Returns the latest build log for each package from the `pkglog` table
- `/pkg/:pkgbase` : Returns all build logs for a specific package (in reverse chronological order)
- `/pkg/:pkgbase/log/:timestamp` : Converts the log content to HTML and returns it with [ANSI to HTML conversion](https://www.npmjs.com/package/ansi-to-html)

## File Structure

- static frontend files
  - `html/`
  - `images/`
  - `static/`
- backend code
  - `src/`
- backend related files
  - `tsconfig.json`
  - `worker-configuration.d.ts`
  - `wrangler.toml`
- dependency management
  - `package.json`
  - `package-lock.json`

## Deploy

You will need another publicly accessible HTTP server to serve `.lilac/logs`

```shell
$ npm install

# create a hyperdrive pointing to your lilac pgsql
# https://developers.cloudflare.com/workers/tutorials/postgres/#8-use-hyperdrive-to-accelerate-queries
$ npx wrangler hyperdrive create <NAME_OF_HYPERDRIVE_CONFIG> --connection-string="postgresql://user:pass@host:5432/postgres"

# update wrangler.toml
# https://developers.cloudflare.com/workers/wrangler/configuration/
$ vim wrangler.toml

# deploy
$ npm run generate-types
$ npm run deploy
```
