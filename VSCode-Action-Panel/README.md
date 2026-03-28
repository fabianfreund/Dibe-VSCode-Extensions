# Action Panel

Action Panel is a simple VS Code extension that reads action definitions from `.dibe/action-panel` inside the current workspace and renders them in a sidebar.

## Files

The extension uses two JSON files:

- `.dibe/action-panel/generated-actions.json`: agent-managed or generated actions
- `.dibe/action-panel/user-actions.json`: user-managed actions that should not be overwritten by automation

Both files use the same structure:

```json
{
  "categories": [
    {
      "id": "project",
      "label": "Project",
      "actions": [
        {
          "id": "npm-install",
          "label": "npm install",
          "command": "npm install"
        }
      ]
    }
  ]
}
```

## Commands

- `Action Panel: Refresh`
- `Action Panel: Open Config`
- `Action Panel: Add User Action`
