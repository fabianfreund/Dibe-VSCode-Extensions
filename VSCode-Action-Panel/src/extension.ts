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
  const currentVersion = getExtensionVersion(context);
  const installState = await updateInstallState(context, currentVersion);
  const treeProvider = new ActionPanelTreeProvider(installState);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("actionPanel.sidebar", treeProvider),
    vscode.commands.registerCommand("actionPanel.refresh", async () => {
      await treeProvider.refresh();
    }),
    vscode.commands.registerCommand("actionPanel.search", async () => {
      await showActionSearch();
    }),
    vscode.commands.registerCommand("actionPanel.openConfig", async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      await openActionPanelDirectory(workspaceFolder);
      await treeProvider.refresh();
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
      await treeProvider.refresh();
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
      terminal.sendText(buildCommandLine(action), true);
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/.dibe/action-panel/*.json");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => void treeProvider.refresh()),
    watcher.onDidCreate(() => void treeProvider.refresh()),
    watcher.onDidDelete(() => void treeProvider.refresh())
  );

  await treeProvider.refresh();
}

export function deactivate(): void {}

class ActionPanelTreeProvider implements vscode.TreeDataProvider<ActionPanelItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ActionPanelItem | undefined>();
  private actionData: LoadedActionData = { categories: [] };

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly installState: InstallState) {}

  async refresh(): Promise<void> {
    const workspaceFolder = getWorkspaceFolder(false);
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
      return Promise.resolve([
        new UpgradeStatusTreeItem(this.installState),
        ...this.actionData.categories.map((category) => new CategoryTreeItem(category))
      ]);
    }

    if (element instanceof CategoryTreeItem) {
      return Promise.resolve(element.category.actions.map((action) => new ActionTreeItem(action)));
    }

    return Promise.resolve([]);
  }
}

abstract class ActionPanelItem extends vscode.TreeItem {}

class UpgradeStatusTreeItem extends ActionPanelItem {
  constructor(installState: InstallState) {
    const label = installState.isUpgrade && installState.previousVersion
      ? `Updated from ${installState.previousVersion} to ${installState.currentVersion}`
      : `Installed version ${installState.currentVersion}`;

    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "actionPanel.status";
    this.description = "Use the search icon in the title bar";
    this.tooltip = label;
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

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
    this.description = action.command;
    this.tooltip = new vscode.MarkdownString(
      [`**${action.command}**`, action.description].filter(Boolean).join("\n\n")
    );
    this.iconPath = new vscode.ThemeIcon("play-circle");
    this.command = {
      command: "actionPanel.runAction",
      title: "Run Action",
      arguments: [action]
    };
  }
}

interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: MergedActionDefinition;
}

interface InstallState {
  currentVersion: string;
  previousVersion?: string;
  isUpgrade: boolean;
}

function getWorkspaceFolder(showWarning = true): vscode.WorkspaceFolder | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder && showWarning) {
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

async function showActionSearch(): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  try {
    await ensureActionPanelFiles(workspaceFolder);
    const actionData = await loadActionData(workspaceFolder);
    const items: ActionQuickPickItem[] = actionData.categories.flatMap((category) =>
      category.actions.map((action) => ({
        label: action.label,
        description: category.label,
        detail: action.command,
        action
      }))
    );

    const selection = await vscode.window.showQuickPick(items, {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "Search actions"
    });

    if (selection) {
      await vscode.commands.executeCommand("actionPanel.runAction", selection.action);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Action Panel search failed: ${message}`);
  }
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
  const rawVersion = context.extension.packageJSON.version;
  return typeof rawVersion === "string" && rawVersion.trim() !== "" ? rawVersion : "0.0.0";
}

async function updateInstallState(
  context: vscode.ExtensionContext,
  currentVersion: string
): Promise<InstallState> {
  const previousVersion = context.globalState.get<string>("actionPanel.installedVersion");
  const isUpgrade = !!previousVersion && previousVersion !== currentVersion;

  if (previousVersion !== currentVersion) {
    await context.globalState.update("actionPanel.installedVersion", currentVersion);
  }

  return {
    currentVersion,
    previousVersion,
    isUpgrade
  };
}
