# yaml-drift

**Your YAML config does not survive the trip to JSON, and nothing tells you.**

[![build](https://github.com/tamerkalla/yaml-drift/actions/workflows/release.yml/badge.svg)](https://github.com/tamerkalla/yaml-drift/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/yaml-drift.svg)](https://www.npmjs.com/package/yaml-drift)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![provenance](https://img.shields.io/badge/provenance-attested-brightgreen.svg)](https://www.npmjs.com/package/yaml-drift)

Forty ordinary config documents — Kubernetes-shaped, CI-shaped,
front-matter-shaped — converted to JSON with `yaml@2.9.0`. Thirty-four of them
come out meaning something other than what they said. The parser mentions one.

| | |
|---|---|
| documents whose meaning changed | **34 of 40** |
| documents the parser said anything about | **1 of 40** |

`zip: 01234` becomes `1234`. `message_id: 1284016338956615682` becomes
`1284016338956615680`. `limit: .inf` becomes `null`. And `country: NO` is the
string `"NO"` here and the boolean `false` in every Python, Ruby and Go reader of
the same file.

None of that is a bug in anything. JSON has no unbounded integers, no infinities
and no non-string keys, and YAML 1.1 and YAML 1.2 disagree about unquoted
scalars. Both gaps are permanent, and both are silent.

`yaml-drift` does the conversion and hands you the list.

## Install

```
npm install yaml-drift
```

## Usage

```js
import { convert } from 'yaml-drift';

const { json, changes } = convert(`name: my-service
region: NO
mode: 0755
`);

console.log(json);
for (const c of changes) {
  console.log(`${c.kind} at ${c.pointer || '/'}: ${c.before} -> ${c.after}`);
}
```

Output:

```text
{"name":"my-service","region":"NO","mode":755}
dialect at /region: false -> "NO"
dialect at /mode: 493 -> 755
number-literal at /mode: 0755 -> 755
```

`region` reads as the string `"NO"` here, but a YAML 1.1 reader — PyYAML, Ruby's
Psych, `sigs.k8s.io/yaml` — resolves the same unquoted scalar as the boolean
`false`. `mode` changes twice: YAML 1.1 treats a leading zero as octal (`0755`
is `493`), and even under the 1.2 rules the literal text `0755` doesn't survive
being turned into the number `755`.

## The ten kinds

Every `Change` has a `kind` and a `severity`. `loss` means information is gone;
`dialect` means a YAML 1.1 reader would disagree with this result; `format`
means the value survived but its written form didn't.

| kind | severity | meaning |
|---|---|---|
| `dialect` | dialect | a YAML 1.1 reader resolves this scalar to a different value |
| `number-precision` | loss | the JSON number isn't the number the literal denotes |
| `number-literal` | format | the value survived; its literal notation (`0x1F`, `1.10`, `-0.0`) didn't |
| `non-finite` | loss | `.inf`, `-.inf` or `.nan` became JSON `null` |
| `key-coerced` | format | a non-string mapping key was turned into a string |
| `key-collision` | loss | two differently-typed keys collided into the same JSON key |
| `merge-key` | dialect | a `<<` pair was kept literal instead of merged (YAML 1.1 behavior) |
| `alias` | format | an alias node became a second, independent copy in JSON |
| `cycle` | loss | a self-referential alias became JSON `null` |
| `tag-dropped` | loss | an explicit tag (`!!binary`, `!!set`, `!!omap`, or a custom tag) has no JSON equivalent |

## CLI

```bash
echo 'id: 9007199254740993' | yaml-drift --check
```

Output:

```text
{"id":9007199254740992}
1:5  loss  number-precision  /id  9007199254740993 -> 9007199254740992
```

That example exits with code `2`: `--check` fails the process whenever a change
has severity `loss`. `--quiet` suppresses the change report on stderr; `json` on
stdout is always written. `--help` and `--version` print and exit `0`. No install
needed to try it first: `npx yaml-drift`.

## What this is not

- **Not a YAML formatter.** It doesn't serialize JavaScript back to YAML, and it
  never rewrites your source file — it only reports.
- **Not a multi-document tool.** A stream with more than one `---`-separated
  document is rejected outright; the change model is per-document.
- **Not a fixer.** Repairing the YAML would mean picking a dialect on the
  caller's behalf. That choice stays with you.

See [VERIFY.md](VERIFY.md) to reproduce the headline numbers yourself, from the
published package, in a clean directory.
