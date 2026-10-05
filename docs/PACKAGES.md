# npm package names

Nothing is published. No npm account or scope was created, and nobody was logged in when these checks ran. The CLI,
the engine and the Action all keep `"private": true`, so a stray `npm publish` fails.

## Checks run

**When:** 2026-10-05, 11:33 UTC. **Tools:** npm 11.21.0 against `https://registry.npmjs.org`, plus `curl`.

```sh
for n in @scasella/undefined @scasella/undefined-certify @scasella/undefined-engine @scasella/undefined-cli \
         @scasella/undefined-action @scasella/certify undefined-certify undefined-gates undefined-cli undefined \
         certify certify-ts tscertify fncertify; do
  npm view "$n" name version --json      # E404 = the name is free
done
npm search --json --searchlimit=10 certify            # nearby names (relevance-ranked; not a free/taken check)
npm search --json --searchlimit=8 "undefined cli"
npm view undefined-cli description bin --json
npm view undefined description time.modified --json
npm view certify description --json
curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/-/user/org.couchdb.user:scasella    # 401
curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/-/org/scasella/package              # 404
curl -s 'https://registry.npmjs.org/-/v1/search?text=scope:scasella'                                  # 0 results
curl -s 'https://registry.npmjs.org/-/v1/search?text=maintainer:scasella'                             # 0 results
npm whoami                                                                                            # ENEEDAUTH
```

Only an `npm view` 404 counts as "free". `npm search` is ranked by relevance and returned unrelated packages, so it was
used only to look for confusable names.

| name | result |
|---|---|
| `@scasella/undefined` | free (E404) |
| `@scasella/undefined-certify` | free (E404) |
| `@scasella/undefined-engine`, `@scasella/undefined-cli`, `@scasella/undefined-action`, `@scasella/certify` | free (E404) |
| `undefined-certify`, `undefined-gates`, `certify-ts`, `tscertify`, `fncertify` | free (E404) |
| `undefined` | taken: 0.1.0, "Just require undefined & everything gonna be defined!", last modified 2022-06-28 |
| `undefined-cli` | taken: 0.0.5, description "cli", bin `itc` |
| `certify` | taken: 0.0.3, "Create X.509 ASN.1 RSA Keypairs" |

**The `@scasella` scope is not verified.** A scope belongs to the npm user or organization of that name. The user lookup
needs a login (401), there is no organization called `scasella` (404), and no package is published under the scope or
by a maintainer of that name. Before publishing, the owner must run `npm login`, then `npm whoami` (it should print
`scasella`), then `npm access list packages @scasella`. If someone else owns the user `scasella`, use the unscoped
fallback below.

## Proposal

The CLI package has one bin, `undefined-certify`. When a package has exactly one bin, `npx <package>` runs it whatever
its name, so `npx <package> certify …` works for both options. A global install gives the command
`undefined-certify certify …` for both.

1. **`@scasella/undefined`** (recommended), bin `undefined-certify`:
   `npx @scasella/undefined certify src/stats.ts --spec src/stats.test.ts --json`.
   - Good: it matches the repository and the site, and the scope makes the bare word "undefined" unambiguous.
   - Risk: someone who drops the scope (`npx undefined`, `npm i undefined`) gets an unrelated 2022 package. "undefined"
     is also a JavaScript value, so it is hard to search for. The READMEs always write the scoped name in full.
2. **`@scasella/undefined-certify`**, bin `undefined-certify`:
   `npx @scasella/undefined-certify certify src/stats.ts`.
   - Good: the package name says what it does and matches the bin, the JSON `format` (`undefined-certify`) and the
     Action's comment marker. If the scope is dropped, the result is the free unscoped name below, not someone else's
     package.
   - Risk: `undefined-certify certify` repeats itself. "certify" can suggest a formal certification. The docs say the
     result is evidence, not proof ([ENGINE.md](ENGINE.md#what-certify-means-and-does-not-mean)).

**Unscoped fallback** if the scope cannot be used: `undefined-certify` (free). Nearby taken names are `certify` (X.509
keys) and `undefined-cli` (bin `itc`). Neither shares the bin name, but `undefined-cli` is one word away.

Neither option uses a trademark or another tool's name: no package name, bin, comment marker or keyword does. "Claude
Code", "Codex" and "Cursor" appear only in the neutrality statement ("certifies code from any source"), in the CLI
README's note that the site's Codex integration is not part of the package, and in the provenance field
`codexVersion`, which is always `null` outside the site.

**Not to be published as packages:**
- The **engine**, `@scasella/undefined-engine`, stays private. Its `exports` point at TypeScript source, which is
  bundled into the CLI and the Action.
- The **Action** is used by path and commit SHA (`uses: scasella/undefined/packages/action@<sha>`), not from npm. Its
  package name, `@scasella/undefined-action`, is internal.

## Where the name is set

The names use option 1, and they match everywhere:
- `packages/cli/package.json`: `name` and `bin`;
- `packages/cli/src/certifyCommand.ts` `TOOL_NAME`, which goes into `--json` `tool.name` and the provenance `certifiedBy`;
- the CLI's JSON snapshots;
- `packages/cli/README.md`, the root README, [ENGINE.md](ENGINE.md) and [WORKSPACE-DESIGN.md §7](WORKSPACE-DESIGN.md).

To switch to option 2, change all of these together. The snapshots are regenerated by the CLI's own tests.

Before publishing:
1. Confirm the scope.
2. Remove `private` from `packages/cli/package.json`.
3. Let CI pass on Node 20 and 22.
4. Run `npm pack --dry-run -w packages/cli`. CI runs it too.
5. Run `npm publish --access public -w packages/cli`. That last step is for the owner, not for an agent.
