import * as vscode from "vscode";

export interface ActionPanelFile {
  categories: ActionCategory[];
}

export interface ActionCategory {
  id: string;
  label: string;
  description?: string;
  order?: number;
  actions: ActionDefinition[];
}

export interface ActionDefinition {
  id: string;
  label: string;
  command: string;
  description?: string;
  workingDirectory?: string;
  args?: string[];
}

export interface MergedActionCategory extends ActionCategory {
  source: "generated" | "user" | "mixed";
  actions: MergedActionDefinition[];
}

export interface MergedActionDefinition extends ActionDefinition {
  source: "generated" | "user";
  categoryId: string;
  categoryLabel: string;
}

export interface LoadedActionData {
  categories: MergedActionCategory[];
}

export const ACTION_PANEL_DIR = ".dibe/action-panel";
export const GENERATED_ACTIONS_FILE = "generated-actions.json";
export const USER_ACTIONS_FILE = "user-actions.json";

const DEFAULT_GENERATED_DATA: ActionPanelFile = {
  categories: [
    {
      id: "project",
      label: "Project",
      description: "Agent-managed starter actions",
      order: 100,
      actions: [
        {
          id: "npm-install",
          label: "npm install",
          command: "npm install",
          description: "Install project dependencies"
        }
      ]
    }
  ]
};

const DEFAULT_USER_DATA: ActionPanelFile = {
  categories: [
    {
      id: "custom",
      label: "Custom",
      description: "User-managed actions",
      order: 1000,
      actions: []
    }
  ]
};

export async function ensureActionPanelFiles(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const directoryUri = getActionPanelDirectoryUri(workspaceFolder);
  await vscode.workspace.fs.createDirectory(directoryUri);

  await ensureFile(workspaceFolder, GENERATED_ACTIONS_FILE, DEFAULT_GENERATED_DATA);
  await ensureFile(workspaceFolder, USER_ACTIONS_FILE, DEFAULT_USER_DATA);
}

export async function loadActionData(workspaceFolder: vscode.WorkspaceFolder): Promise<LoadedActionData> {
  await ensureActionPanelFiles(workspaceFolder);

  const generated = await readActionFile(workspaceFolder, GENERATED_ACTIONS_FILE);
  const user = await readActionFile(workspaceFolder, USER_ACTIONS_FILE);

  const byCategory = new Map<string, MergedActionCategory>();

  for (const category of generated.categories) {
    mergeCategory(byCategory, category, "generated");
  }

  for (const category of user.categories) {
    mergeCategory(byCategory, category, "user");
  }

  const categories = Array.from(byCategory.values()).sort(sortCategories);
  for (const category of categories) {
    category.actions.sort(sortActions);
  }

  return { categories };
}

export async function addUserAction(
  workspaceFolder: vscode.WorkspaceFolder,
  action: ActionDefinition,
  categoryLabel: string
): Promise<void> {
  await ensureActionPanelFiles(workspaceFolder);

  const userData = await readActionFile(workspaceFolder, USER_ACTIONS_FILE);
  const categoryId = toId(categoryLabel);
  const existingCategory = userData.categories.find((category) => category.id === categoryId);

  if (existingCategory) {
    existingCategory.label = categoryLabel;
    existingCategory.actions.push(action);
  } else {
    userData.categories.push({
      id: categoryId,
      label: categoryLabel,
      actions: [action]
    });
  }

  await writeActionFile(workspaceFolder, USER_ACTIONS_FILE, userData);
}

export async function openActionPanelDirectory(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  await ensureActionPanelFiles(workspaceFolder);
  const generatedUri = getActionPanelFileUri(workspaceFolder, GENERATED_ACTIONS_FILE);
  const userUri = getActionPanelFileUri(workspaceFolder, USER_ACTIONS_FILE);

  const generatedDocument = await vscode.workspace.openTextDocument(generatedUri);
  await vscode.window.showTextDocument(generatedDocument, { preview: false });

  const userDocument = await vscode.workspace.openTextDocument(userUri);
  await vscode.window.showTextDocument(userDocument, { preview: false });
}

function getActionPanelDirectoryUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(workspaceFolder.uri, ACTION_PANEL_DIR);
}

function getActionPanelFileUri(workspaceFolder: vscode.WorkspaceFolder, fileName: string): vscode.Uri {
  return vscode.Uri.joinPath(getActionPanelDirectoryUri(workspaceFolder), fileName);
}

async function ensureFile(
  workspaceFolder: vscode.WorkspaceFolder,
  fileName: string,
  defaultData: ActionPanelFile
): Promise<void> {
  const fileUri = getActionPanelFileUri(workspaceFolder, fileName);

  try {
    await vscode.workspace.fs.stat(fileUri);
  } catch {
    const contents = JSON.stringify(defaultData, null, 2);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(contents, "utf8"));
  }
}

async function readActionFile(
  workspaceFolder: vscode.WorkspaceFolder,
  fileName: string
): Promise<ActionPanelFile> {
  const fileUri = getActionPanelFileUri(workspaceFolder, fileName);
  const raw = await vscode.workspace.fs.readFile(fileUri);
  const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
  return validateActionPanelFile(parsed, fileName);
}

async function writeActionFile(
  workspaceFolder: vscode.WorkspaceFolder,
  fileName: string,
  data: ActionPanelFile
): Promise<void> {
  const fileUri = getActionPanelFileUri(workspaceFolder, fileName);
  const contents = JSON.stringify(data, null, 2);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(contents, "utf8"));
}

function validateActionPanelFile(input: unknown, fileName: string): ActionPanelFile {
  if (!isRecord(input) || !Array.isArray(input.categories)) {
    throw new Error(`${fileName} must contain a top-level categories array.`);
  }

  const categories = input.categories.map((category, categoryIndex) =>
    validateCategory(category, fileName, categoryIndex)
  );

  return { categories };
}

function validateCategory(input: unknown, fileName: string, categoryIndex: number): ActionCategory {
  if (!isRecord(input)) {
    throw new Error(`${fileName} category at index ${categoryIndex} must be an object.`);
  }

  const { id, label, description, order, actions } = input;

  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${fileName} category at index ${categoryIndex} is missing a valid id.`);
  }

  if (typeof label !== "string" || label.trim() === "") {
    throw new Error(`${fileName} category "${id}" is missing a valid label.`);
  }

  if (!Array.isArray(actions)) {
    throw new Error(`${fileName} category "${id}" must contain an actions array.`);
  }

  return {
    id,
    label,
    description: typeof description === "string" ? description : undefined,
    order: typeof order === "number" ? order : undefined,
    actions: actions.map((action, actionIndex) => validateAction(action, fileName, id, actionIndex))
  };
}

function validateAction(
  input: unknown,
  fileName: string,
  categoryId: string,
  actionIndex: number
): ActionDefinition {
  if (!isRecord(input)) {
    throw new Error(`${fileName} action at index ${actionIndex} in category "${categoryId}" must be an object.`);
  }

  const { id, label, command, description, workingDirectory, args } = input;

  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${fileName} action at index ${actionIndex} in category "${categoryId}" is missing a valid id.`);
  }

  if (typeof label !== "string" || label.trim() === "") {
    throw new Error(`${fileName} action "${id}" in category "${categoryId}" is missing a valid label.`);
  }

  if (typeof command !== "string" || command.trim() === "") {
    throw new Error(`${fileName} action "${id}" in category "${categoryId}" is missing a valid command.`);
  }

  if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))) {
    throw new Error(`${fileName} action "${id}" in category "${categoryId}" has invalid args.`);
  }

  if (workingDirectory !== undefined && typeof workingDirectory !== "string") {
    throw new Error(`${fileName} action "${id}" in category "${categoryId}" has invalid workingDirectory.`);
  }

  return {
    id,
    label,
    command,
    description: typeof description === "string" ? description : undefined,
    workingDirectory: typeof workingDirectory === "string" ? workingDirectory : undefined,
    args: Array.isArray(args) ? args : undefined
  };
}

function mergeCategory(
  byCategory: Map<string, MergedActionCategory>,
  category: ActionCategory,
  source: "generated" | "user"
): void {
  const existing = byCategory.get(category.id);
  const actions = category.actions.map((action) => ({
    ...action,
    source,
    categoryId: category.id,
    categoryLabel: category.label
  }));

  if (!existing) {
    byCategory.set(category.id, {
      ...category,
      source,
      actions
    });
    return;
  }

  existing.label = existing.label || category.label;
  existing.description = existing.description || category.description;
  existing.order = existing.order ?? category.order;
  existing.source = existing.source === source ? source : "mixed";
  existing.actions.push(...actions);
}

function sortCategories(left: MergedActionCategory, right: MergedActionCategory): number {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.label.localeCompare(right.label);
}

function sortActions(left: MergedActionDefinition, right: MergedActionDefinition): number {
  return left.label.localeCompare(right.label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
