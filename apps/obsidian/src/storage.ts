import {
  createDefaultAppSettings,
  type AppSettings,
  type RecoveryStateSnapshot,
  type UserFormulaEntry,
} from '@mathslot/ui';

export interface CorruptBackupEntry {
  id: string;
  timestamp: string;
  reason: string;
  rawLibraryJson: string;
}

export interface PluginPersistedData {
  schemaVersion?: number;
  libraryJson?: string;
  lastValidLibraryJson?: string;
  backupJson?: CorruptBackupEntry[];
  settings?: AppSettings;
}

export interface LibraryValidationResult {
  ok: boolean;
  libraryJson: string;
  recovery: RecoveryStateSnapshot | null;
}

export const DEFAULT_EMPTY_LIBRARY_JSON = JSON.stringify({
  schema_version: 3,
  customFormats: [],
  snippets: [],
});

function validateParsedLibrary(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Library JSON root must be an object.';
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.schema_version !== 'number') {
    return 'Library JSON missing numeric schema_version.';
  }
  if ('customFormats' in obj && !Array.isArray(obj.customFormats)) {
    return 'Library JSON customFormats must be an array.';
  }
  if ('snippets' in obj && !Array.isArray(obj.snippets)) {
    return 'Library JSON snippets must be an array.';
  }
  return null;
}

export async function loadAndValidateLibrary(
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
): Promise<LibraryValidationResult> {
  const raw = data.libraryJson;
  if (!raw || raw.trim().length === 0) {
    const initial =
      data.lastValidLibraryJson && data.lastValidLibraryJson.trim().length > 0
        ? data.lastValidLibraryJson
        : DEFAULT_EMPTY_LIBRARY_JSON;
    data.libraryJson = initial;
    data.lastValidLibraryJson = initial;
    await saveData(data);
    return {
      ok: true,
      libraryJson: initial,
      recovery: null,
    };
  }

  let errorMessage: string | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    errorMessage = validateParsedLibrary(parsed);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (errorMessage !== null) {
    const entry: CorruptBackupEntry = {
      id: `corrupt-${Date.now()}`,
      timestamp: new Date().toISOString(),
      reason: errorMessage,
      rawLibraryJson: raw,
    };
    const existing = Array.isArray(data.backupJson) ? data.backupJson : [];
    data.backupJson = [...existing, entry];
    await saveData(data);

    const recovery: RecoveryStateSnapshot = {
      corrupt_path: `obsidian://plugin-data/backupJson/${entry.id}`,
      backup_candidate:
        data.lastValidLibraryJson && data.lastValidLibraryJson.trim().length > 0
          ? 'obsidian://plugin-data/lastValidLibraryJson'
          : null,
      error: errorMessage,
    };

    return {
      ok: false,
      libraryJson:
        data.lastValidLibraryJson && data.lastValidLibraryJson.trim().length > 0
          ? data.lastValidLibraryJson
          : DEFAULT_EMPTY_LIBRARY_JSON,
      recovery,
    };
  }

  data.lastValidLibraryJson = raw;
  return {
    ok: true,
    libraryJson: raw,
    recovery: null,
  };
}

export async function restoreFromBackup(
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
): Promise<string> {
  const restored =
    data.lastValidLibraryJson && data.lastValidLibraryJson.trim().length > 0
      ? data.lastValidLibraryJson
      : DEFAULT_EMPTY_LIBRARY_JSON;
  data.libraryJson = restored;
  data.lastValidLibraryJson = restored;
  await saveData(data);
  return restored;
}

export async function resetEmptyLibrary(
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
): Promise<string> {
  data.libraryJson = DEFAULT_EMPTY_LIBRARY_JSON;
  data.lastValidLibraryJson = DEFAULT_EMPTY_LIBRARY_JSON;
  await saveData(data);
  return DEFAULT_EMPTY_LIBRARY_JSON;
}

function normalizeUserFormulaEntry(raw: unknown, idx: number): UserFormulaEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const source =
    typeof obj.source === 'string'
      ? obj.source
      : typeof obj.latex === 'string'
        ? obj.latex
        : '';
  if (!source.trim()) return null;
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : `snippet-${idx + 1}`,
    name: typeof obj.name === 'string' && obj.name ? obj.name : `片段 ${source.slice(0, 18)}`,
    category: typeof obj.category === 'string' && obj.category ? obj.category : '自定义',
    source,
    desc: typeof obj.desc === 'string' ? obj.desc : '从编辑器保存',
    tags: Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === 'string')
      : ['snippet'],
    is_builtin: false,
    created_at: typeof obj.created_at === 'number' ? obj.created_at : undefined,
  };
}

function parseLibraryRecord(rawLibraryJson: string | undefined): Record<string, unknown> {
  const raw = rawLibraryJson && rawLibraryJson.trim().length > 0 ? rawLibraryJson : DEFAULT_EMPTY_LIBRARY_JSON;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall back to empty library object; corruption recovery handles invalid JSON separately.
  }
  return {
    schema_version: 3,
    customFormats: [],
    snippets: [],
  };
}

export function readUserFormulas(data: PluginPersistedData): UserFormulaEntry[] {
  const lib = parseLibraryRecord(data.libraryJson);
  const rawList = Array.isArray(lib.snippets)
    ? lib.snippets
    : Array.isArray(lib.user_formulas)
      ? lib.user_formulas
      : [];
  const entries: UserFormulaEntry[] = [];
  rawList.forEach((item, idx) => {
    const normalized = normalizeUserFormulaEntry(item, idx);
    if (normalized) {
      entries.push(normalized);
    }
  });
  return entries;
}

export async function saveUserSnippet(
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
  source: string,
  latex: string,
): Promise<UserFormulaEntry[]> {
  const snippetSource = source.trim().length > 0 ? source : latex;
  if (!snippetSource.trim()) {
    return readUserFormulas(data);
  }
  const lib = parseLibraryRecord(data.libraryJson);
  const existing = readUserFormulas(data);
  const entry: UserFormulaEntry = {
    id: `snippet-${Date.now()}-${existing.length + 1}`,
    name: `片段 ${snippetSource.slice(0, 18)}`,
    category: '自定义',
    source: snippetSource,
    desc: '从编辑器保存',
    tags: ['snippet'],
    is_builtin: false,
    created_at: Math.floor(Date.now() / 1000),
  };
  const updated = [...existing, entry];
  const nextLib = {
    ...lib,
    schema_version: typeof lib.schema_version === 'number' ? lib.schema_version : 3,
    snippets: updated,
  };
  const serialized = JSON.stringify(nextLib);
  data.libraryJson = serialized;
  data.lastValidLibraryJson = serialized;
  await saveData(data);
  return updated;
}

export function exportPluginConfigJson(
  data: PluginPersistedData,
  currentSettings?: AppSettings,
): string {
  const lib = parseLibraryRecord(data.libraryJson);
  return JSON.stringify(
    {
      schema_version: 3,
      settings: currentSettings ?? data.settings ?? createDefaultAppSettings(),
      customFormats: Array.isArray(lib.customFormats) ? lib.customFormats : [],
      snippets: readUserFormulas(data),
    },
    null,
    2,
  );
}

export async function importPluginConfigJson(
  rawJson: string,
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
): Promise<{ settings?: AppSettings; libraryJson: string; userFormulas: UserFormulaEntry[] }> {
  const parsed: unknown = JSON.parse(rawJson);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Config JSON root must be an object.');
  }
  const obj = parsed as Record<string, unknown>;
  const libObj = parseLibraryRecord(
    typeof obj.libraryJson === 'string' ? obj.libraryJson : JSON.stringify(obj),
  );
  const nextLib = {
    schema_version: typeof libObj.schema_version === 'number' ? libObj.schema_version : 3,
    customFormats: Array.isArray(libObj.customFormats) ? libObj.customFormats : [],
    snippets: Array.isArray(libObj.snippets)
      ? libObj.snippets
      : Array.isArray(libObj.user_formulas)
        ? libObj.user_formulas
        : [],
  };
  const validationErr = validateParsedLibrary(nextLib);
  if (validationErr !== null) {
    throw new Error(validationErr);
  }

  let nextSettings: AppSettings | undefined;
  if (typeof obj.settings === 'object' && obj.settings !== null && !Array.isArray(obj.settings)) {
    const rawSettings = obj.settings as Partial<AppSettings>;
    const defaults = createDefaultAppSettings();
    nextSettings = {
      ...defaults,
      ...rawSettings,
      shortcuts: {
        ...defaults.shortcuts,
        ...(typeof rawSettings.shortcuts === 'object' && rawSettings.shortcuts !== null
          ? rawSettings.shortcuts
          : {}),
      },
    };
    data.settings = nextSettings;
  }

  const serialized = JSON.stringify(nextLib);
  data.libraryJson = serialized;
  data.lastValidLibraryJson = serialized;
  await saveData(data);

  return {
    settings: nextSettings,
    libraryJson: serialized,
    userFormulas: readUserFormulas(data),
  };
}
