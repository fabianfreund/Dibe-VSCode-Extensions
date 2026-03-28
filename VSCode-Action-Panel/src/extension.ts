import * as vscode from "vscode";
import {
  ActionDefinition,
  LoadedActionData,
  MergedActionCategory,
  MergedActionDefinition,
  addUserAction,
  ensureActionPanelFiles,
  loadActionData,
  openActionPanelDirectory,
  toId
} from "./model";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new ActionPanelProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("actionPanel.sidebar", provider),
    vscode.commands.registerCommand("actionPanel.refresh", async () => {
      await provider.refresh();
    }),
    vscode.commands.registerCommand("actionPanel.openConfig", async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      await openActionPanelDirectory(workspaceFolder);
      await provider.refresh();
    }),
    vscode.commands.registerCommand("actionPanel.addUserAction", async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const categoryLabel = await vscode.window.showInputBox({
        prompt: "Category name",
        placeHolder: "Custom"
      });

      if (!categoryLabel) {
        return;
      }

      const label = await vscode.window.showInputBox({
        prompt: "Action label",
        placeHolder: "npm install"
      });

      if (!label) {
        return;
      }

      const command = await vscode.window.showInputBox({
        prompt: "Shell command",
        placeHolder: "npm install"
      });

      if (!command) {
        return;
      }

      const workingDirectory = await vscode.window.showInputBox({
        prompt: "Working directory (optional, relative to workspace)",
        placeHolder: "."
      });

      const description = await vscode.window.showInputBox({
        prompt: "Description (optional)",
        placeHolder: "Install project dependencies"
      });

      const action: ActionDefinition = {
        id: toId(label),
        label,
        command,
        description: description || undefined,
        workingDirectory: workingDirectory || undefined
      };

      await addUserAction(workspaceFolder, action, categoryLabel);
      await provider.refresh();
      vscode.window.showInformationMessage(`Added "${label}" to ${categoryLabel}.`);
    }),
    vscode.commands.registerCommand("actionPanel.runAction", async (action: MergedActionDefinition) => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: `Action Panel: ${action.label}`,
        cwd: resolveWorkingDirectory(workspaceFolder, action.workingDirectory)
      });

      terminal.show(true);
      const commandLine = buildCommandLine(action);
      terminal.sendText(commandLine, true);
    })
  );

  await provider.refresh();
}

export function deactivate(): void {}

class ActionPanelProvider implements vscode.TreeDataProvider<ActionPanelItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ActionPanelItem | undefined>();
  private actionData: LoadedActionData = { categories: [] };

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  async refresh(): Promise<void> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      this.actionData = { categories: [] };
      this.onDidChangeTreeDataEmitter.fire(undefined);
      return;
    }

    try {
      await ensureActionPanelFiles(workspaceFolder);
      this.actionData = await loadActionData(workspaceFolder);
    } catch (error) {
      this.actionData = { categories: [] };
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Action Panel could not load actions: ${message}`);
    }

    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: ActionPanelItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ActionPanelItem): Thenable<ActionPanelItem[]> {
    if (!element) {
      return Promise.resolve(
        this.actionData.categories.map((category) => new CategoryTreeItem(category))
      );
    }

    if (element instanceof CategoryTreeItem) {
      return Promise.resolve(
        element.category.actions.map((action) => new ActionTreeItem(action))
      );
    }

    return Promise.resolve([]);
  }
}

abstract class ActionPanelItem extends vscode.TreeItem {}

class CategoryTreeItem extends ActionPanelItem {
  constructor(readonly category: MergedActionCategory) {
    super(category.label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "actionPanel.category";
    this.description = category.description;
    this.tooltip = category.description ?? category.label;
    this.iconPath = new vscode.ThemeIcon("folder-library");
  }
}

class ActionTreeItem extends ActionPanelItem {
  constructor(readonly action: MergedActionDefinition) {
    super(action.label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "actionPanel.action";
    this.description = action.description;
    this.tooltip = new vscode.MarkdownString(
      [`${action.command}`, action.description].filter(Boolean).join("\n\n")
    );
    this.iconPath = new vscode.ThemeIcon("play-circle");
    this.command = {
      command: "actionPanel.runAction",
      title: "Run Action",
      arguments: [action]
    };
  }
}

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    void vscode.window.showWarningMessage("Action Panel requires an open workspace folder.");
  }

  return workspaceFolder;
}

function resolveWorkingDirectory(
  workspaceFolder: vscode.WorkspaceFolder,
  relativeWorkingDirectory?: string
): string {
  if (!relativeWorkingDirectory) {
    return workspaceFolder.uri.fsPath;
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, relativeWorkingDirectory).fsPath;
}

function buildCommandLine(action: MergedActionDefinition): string {
  const extraArgs = action.args?.join(" ") ?? "";
  return [action.command, extraArgs].filter(Boolean).join(" ");
}
