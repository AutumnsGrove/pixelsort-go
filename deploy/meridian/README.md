# Meridian additions

Three small snippets to add to Meridian's own config by hand. **Nothing in this repository edits Meridian**, and the agent that
wrote these never touched it: applying them is Autumn's step (docs/dev/phase-8.md, P8-T11).

| Snippet | Goes in | What it adds |
|---|---|---|
| `targets.json.snippet` | Meridian's `targets.json` | A `pixelsort` compose target with start, stop, restart and an **update** action that starts `pixelsort-update.service` (the same watcher the Settings button uses) |
| `observe.json.snippet` | Meridian's `observe.json` | Lets Meridian show whether `pixelsort-update.path` is active |
| `config-snippet.yaml` | Meridian's tile config | A tile probing `http://localhost:8895/healthz`, with the version as a vital, and a `disk_used` vital from `/api/usage` (`used_bytes` against `budget_bytes`) |

The field names follow the Warbler, Polaris and Ivy entries as described in `docs/update.md`. If Meridian's schema has moved on, keep the
values and adjust the keys. Check each against a neighbouring entry before pasting. `test.sh` only checks that every snippet parses.
