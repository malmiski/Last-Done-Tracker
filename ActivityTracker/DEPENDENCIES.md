# Dependency notes

## `overrides.react-server-dom-webpack` — why it is pinned to `~19.0.4`

**Do not remove this override without reading this.** Removing it makes
`npm install <anything>` fail with `ERESOLVE`.

### What happens without it

```
npm error Conflicting peer dependency: react@19.2.8
npm error   peer react@"^19.2.8" from react-server-dom-webpack@19.2.8
npm error     peerOptional react-server-dom-webpack@">= 19.0.0" from expo-router@6.0.13
```

### Why

Expo SDK 54 pins **react 19.1.0**. Two packages declare an *optional* peer on
`react-server-dom-webpack`, with incompatible ideas of which version:

| Package | Range it allows |
| --- | --- |
| `expo-router@6.0.13` | `>= 19.0.0` |
| `jest-expo@54.0.17` | `~19.0.4 \|\| ~19.1.5 \|\| ~19.2.4` |

`expo-router`'s open-ended `>= 19.0.0` lets npm pick the newest release. Every
`react-server-dom-webpack` release pins its own react peer tightly to its own
version, because React Server Component internals are version-locked:

| Version | Its `react` peer | Satisfied by react 19.1.0? |
| --- | --- | --- |
| 19.2.8 (what npm picks) | `^19.2.8` | no |
| 19.2.4 | `^19.2.4` | no |
| 19.1.5 | `^19.1.5` | no — 19.1.0 < 19.1.5 |
| **19.0.8** (`~19.0.4` resolves here) | **`^19.0.8`** | **yes** |

Only the `19.0.x` line has a peer range loose enough at the bottom end to
accept 19.1.0, and it is also the first option `jest-expo` explicitly blesses.
So `~19.0.4` is the one choice that satisfies all three constraints at once.

### Is the older version a problem?

No. `react-server-dom-webpack` is a `peerOptional` in both packages, needed
only for React Server Components / server functions. This app does not enable
them — there is no `experiments.reactServerFunctions` in `app.json`, and the
package is never imported. It is installed purely to satisfy peer resolution
and is not part of any bundle.

### Why this appeared when it did

It was always latent. `package-lock.json` already recorded
`react-server-dom-webpack@19.2.8` against react 19.1.0 — an unsatisfiable
combination that got in via an earlier `--force` or `--legacy-peer-deps`
install. `npm install` with no arguments replays the lockfile and never
re-checks, so nothing complained. Adding *any* new dependency forces npm to
re-resolve the tree, which is when it validates peers and fails.

The override fixes the underlying resolution rather than suppressing the
check, which is why it is preferred over `--legacy-peer-deps`. If you ever do
need the escape hatch, `npm install --legacy-peer-deps` reproduces the old
(technically broken) tree.

### Upgrading

When Expo bumps react past 19.2.8, drop the override and let npm resolve
normally. Verify with:

```bash
npm ls react-server-dom-webpack   # should report no invalid peers
```

## `expo-image`

Replaces `react-native`'s `Image` for all entry photos. Chosen for three
properties that directly bound memory: decode-to-display-size
(`allowDownscaling`), bitmap recycling via `recyclingKey`, and a per-call-site
`cachePolicy`. Requires a native rebuild.

Note that on **web** most of this is inert — `recyclingKey`, `allowDownscaling`
and `cachePolicy` are largely no-ops and `clearMemoryCache()` does nothing.
Web memory is bounded instead by the object-URL LRU in `imageStore.web.ts` and
the viewport gating in `AppImage.tsx`.

## `fflate`

Pure JavaScript, zero dependencies, no native module — so it works unchanged on
iOS, Android and web. Used for the streaming zip writer behind Export/Import
backup. The streaming API matters: building the archive in memory would
reintroduce the out-of-memory failure the image refactor exists to remove.
