<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# Security

## Token handling

- No tokens live in the repository. Tokens come from the provider's CLI
  (`gh auth token` for the GitHub provider) at runtime. They never land
  on disk or in logs. The logger redacts any object key named `token`,
  `authorization`, or `auth`, and any value matching `Bearer ...`
  (case-insensitive).
- `tests/redaction.test.ts` feeds a canned token string through every
  logger helper and asserts the token never shows up in the output.

## File permissions

- SQLite deduplication file: mode `0600`.
- State directory: mode `0700`.
- `pending.json`: mode `0600` (enforced after atomic rename).

## Input validation

- Every provider response is validated before any DB insert. URLs must
  match the canonical `https://<host>/<owner>/<repo>/pull/<n>` shape.
  Review IDs must be finite numbers. Invalid rows drop with a warning.
- Environment variable overrides that control paths reject `..`, newlines, and
  carriage returns.
- The scheduler sentinel block assembles only from validated values.

## SQL

- Every statement goes through `db.query(...)` with named parameters
  (`$pr_url`, `$review_id`, `$seen_at`). No string concatenation ever.
- `tests/discipline.test.ts` greps the source tree to enforce this.

## Error catalog

Every failure maps to a typed `PollerError` subclass with a stable
`code`. See `src/errors.ts` for the full hierarchy. Every code has a
corresponding test in `tests/error-paths.test.ts`.

## Supply chain

- `.github/workflows/codeql.yml` runs CodeQL (security-and-quality)
  on every PR, every push to `master`, and weekly.
- `.github/dependabot.yml` opens weekly grouped dependency pull requests for the npm ecosystem
  and GitHub Actions.
- `tests/secrets-scan.test.ts` + the `secrets-scan` CI job refuse any
  tree containing a secret-shaped string or a hard-coded home path.

## Reporting a vulnerability

Open a private security advisory via the repository's Security tab, or
email the maintainer. Do not open a public issue for vulnerabilities
until a fix is available.
