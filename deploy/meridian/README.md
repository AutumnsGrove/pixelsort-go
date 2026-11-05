# Meridian additions

Three small snippets to add to Meridian's own config by hand. **Nothing in this repository edits Meridian**, and the agent that
wrote these never touched it: applying them is Autumn's step (docs/dev/phase-8.md, P8-T11).

| Snippet | Goes in | What it adds |
|---|---|---|
| `targets.json.snippet` | Meridian's `targets.json` | A `pixelsort` compose target with start, stop, restart and an **update** action that starts `pixelsort-update.service` (the same watcher the Settings button uses) |
| `observe.json.snippet` | Meridian's `observe.json` | Lets Meridian show whether `pixelsort-update.path` is active |
| `config-snippet.yaml` | Meridian's `services:` list (its tile config) | A tile probing `http://localhost:8895/healthz`, with the version as a vital, and a `disk_used` vital from `/api/usage` (`used_bytes` against `budget_bytes`) |

The field names were checked against the live config on lepotato on 2026-11-05 (the earlier revision guessed
`tiles:` / `probe:`; Meridian uses `services:` / `probes:`). Meridian does not expand `~`: the target's `dir` is
`/home/autumn/Pixelsort`. Check each against a neighbouring entry before pasting. `test.sh` only checks that every
snippet parses.
