---
name: vs-code-action-panel
description: Maintain the VS Code Action Panel extension's action catalog. Use when working in this repo or another repo with `.dibe/action-panel` to curate `generated-actions.json`, preserve `user-actions.json`, add important project actions back when missing, and remove stale generated actions that no longer match the project.
---

# VS Code Action Panel

Use this skill when the task involves curating, regenerating, or cleaning the action panel JSON that powers the extension sidebar.

## What this skill owns

- `.dibe/action-panel/generated-actions.json`
- The generated action categories and actions inside it
- Project-specific action discovery from `package.json`, common scripts, and obvious developer workflows

Do not edit or overwrite `.dibe/action-panel/user-actions.json` unless the user explicitly asks for a user-owned action change.

## Workflow

1. Inspect the repo before editing actions.
2. Find the real developer entrypoints:
   - `package.json` scripts
   - common setup commands such as `npm install`
   - packaging, testing, linting, build, dev, and release commands
   - project-specific maintenance commands if they are clearly active
3. Keep only actions that are currently valid and useful.
4. Re-add important baseline actions if they are missing.
5. Remove stale generated actions that point to deleted scripts or obsolete workflows.

## Baseline actions for this repo

For this extension repo, generated actions should normally include:

- `npm install`
- `npm run build`
- `npm run watch`
- `npm run package`
- install the local `.vsix` with `code --install-extension ...` if the built artifact exists

Keep the list compact. Avoid adding redundant aliases, one-off debug commands, or actions that are already obsolete.

## JSON rules

- Read and write `.dibe/action-panel/generated-actions.json`
- Use the nested shape: top-level `categories`, each with `actions`
- Prefer stable category ids and action ids
- Prefer labels that read well in the sidebar
- Use workspace-relative `workingDirectory` only when needed
- Keep ordering deterministic

## Default categories

Use a small set of practical categories:

- `setup` for dependency/bootstrap commands
- `development` for build/watch/test/dev commands
- `release` for packaging or install-from-vsix flows

Only add more categories if the repo clearly needs them.

## Validation

Before finishing:

- verify each generated action command still exists and is runnable in principle
- confirm generated actions are still relevant to the current repo
- confirm no user-owned actions were touched
