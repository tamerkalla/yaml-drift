# Verifying yaml-drift

This reproduces the headline claim of the README — **34 of 40** ordinary config
documents change meaning on the way to JSON — from the published package, in a
clean directory. It does not require this repository to be checked out.

```bash
mkdir -p yaml-drift-verify && cd yaml-drift-verify
npm init -y >/dev/null 2>&1
npm install yaml-drift@latest >/dev/null 2>&1
cat > verify.mjs <<'JS'
import { inspect } from 'yaml-drift';

const docs = [
  'name: service\nimage: nginx\n',
  'replicas: 3\nport: 8080\n',
  'enabled: true\ndebug: false\n',
  'spec:\n  template:\n    name: web\n',
  'args:\n  - --verbose\n  - --port=80\n',
  'country: "NO"\n',
  'country: NO\n',
  'confirm: yes\n',
  'tls: on\ncompression: off\n',
  'answer: y\n',
  'cron_window: 12:30\n',
  'elapsed: 1:2:3\n',
  'threshold: 1_000\n',
  'mask: 0b1010\n',
  'mode: 0755\n',
  'zip: 01234\n',
  'color: 0x1F\n',
  'released: 2001-12-14\n',
  'created: 2001-12-14T21:59:43.10-05:00\n',
  'version: 1.10\n',
  'limit: .inf\n',
  'floor: -.inf\n',
  'ratio: .nan\n',
  'id: 9007199254740993\n',
  'message_id: 1284016338956615682\n',
  'nonce: 123456789012345678901234567890\n',
  'delta: -0.0\n',
  'epsilon: 0.1000000000000000055511151231257827\n',
  '1: one\n"1": two\n',
  'true: enabled\n',
  'null: nothing\n',
  '? [a, b]\n: pair\n',
  '? {a: 1}\n: nested\n',
  'base: &b\n  cpu: 1\nchild:\n  <<: *b\n  mem: 2\n',
  'anchor: &a {k: 1}\nuse: *a\n',
  '&root\nself: *root\n',
  'blob: !!binary "R0lGODlhAQABAAAAACw="\n',
  'members: !!set\n  ? alice\n  ? bob\n',
  'ordered: !!omap\n  - a: 1\n  - b: 2\n',
  'thing: !mytag 1\n',
];

const changed = docs.filter((d) => inspect(d).length > 0).length;
console.log(`${changed} of ${docs.length} documents changed meaning`);
JS
node verify.mjs
```

Expected output:

```text
34 of 40 documents changed meaning
```

These forty documents are exactly the corpus described in the project's test
suite: plain config that any YAML library round-trips cleanly, alongside the
bare booleans, sexagesimal numbers, oversized integers, non-string keys,
anchors, and explicit tags that don't.
