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
  recoveryActive?: boolean;
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

let uniqueIdSeq = 0;

function generateUniqueId(prefix?: string): string {
  uniqueIdSeq = (uniqueIdSeq + 1) & 0xffff;
  let core: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    core = crypto.randomUUID();
  } else {
    const timeHex = Date.now().toString(16).padStart(12, '0');
    const seqHex = uniqueIdSeq.toString(16).padStart(4, '0');
    const randHex = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
    core = `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-4${seqHex.slice(1)}-8${seqHex.slice(0, 3)}-${randHex}${seqHex}`;
  }
  return prefix ? `${prefix}-${core}` : core;
}

function hasBuiltinTrueFlag(arr: unknown[], fieldName: string): string | null {
  for (const item of arr) {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.is_builtin === true || rec.isBuiltin === true) {
        return `Builtin entries (is_builtin: true) in ${fieldName} cannot enter user storage.`;
      }
    }
  }
  return null;
}

function validateParsedLibrary(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Library JSON root must be an object.';
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.schema_version !== 'number' ||
    !Number.isInteger(obj.schema_version) ||
    (obj.schema_version !== 1 && obj.schema_version !== 2 && obj.schema_version !== 3)
  ) {
    return `Unsupported or non-integer schema_version: ${String(obj.schema_version)}.`;
  }
  if ('customFormats' in obj && !Array.isArray(obj.customFormats)) {
    return 'Library JSON customFormats must be an array.';
  }
  if ('custom_formats' in obj && !Array.isArray(obj.custom_formats)) {
    return 'Library JSON custom_formats must be an array.';
  }
  if ('overrides' in obj && !Array.isArray(obj.overrides)) {
    return 'Library JSON overrides must be an array.';
  }
  if ('snippets' in obj) {
    if (!Array.isArray(obj.snippets)) {
      return 'Library JSON snippets must be an array.';
    }
    const err = hasBuiltinTrueFlag(obj.snippets, 'snippets');
    if (err !== null) return err;
  }
  if ('user_formulas' in obj) {
    if (!Array.isArray(obj.user_formulas)) {
      return 'Library JSON user_formulas must be an array.';
    }
    const err = hasBuiltinTrueFlag(obj.user_formulas, 'user_formulas');
    if (err !== null) return err;
  }
  if ('formulas' in obj) {
    if (!Array.isArray(obj.formulas)) {
      return 'Library JSON formulas must be an array.';
    }
    const err = hasBuiltinTrueFlag(obj.formulas, 'formulas');
    if (err !== null) return err;
  }
  return null;
}

export function isLibraryValidForWrites(data: PluginPersistedData): boolean {
  if (data.recoveryActive === true) {
    return false;
  }
  if (data.libraryJson === undefined) {
    return true;
  }
  if (typeof data.libraryJson !== 'string') {
    return false;
  }
  if (data.libraryJson.trim().length === 0) {
    return true;
  }
  try {
    const parsed: unknown = JSON.parse(data.libraryJson);
    return validateParsedLibrary(parsed) === null;
  } catch {
    return false;
  }
}

export async function loadAndValidateLibrary(
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
): Promise<LibraryValidationResult> {
  const raw = data.libraryJson;
  const fallbackBackup =
    typeof data.lastValidLibraryJson === 'string' && data.lastValidLibraryJson.trim().length > 0
      ? data.lastValidLibraryJson
      : null;

  if (raw === undefined || (typeof raw === 'string' && raw.trim().length === 0)) {
    const initial = fallbackBackup ?? DEFAULT_EMPTY_LIBRARY_JSON;
    const nextData: PluginPersistedData = {
      ...data,
      libraryJson: initial,
      lastValidLibraryJson: initial,
      recoveryActive: false,
    };
    await saveData(nextData);
    Object.assign(data, nextData);
    return {
      ok: true,
      libraryJson: initial,
      recovery: null,
    };
  }

  let errorMessage: string | null = null;
  const rawSnapshot = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (typeof raw !== 'string') {
    errorMessage = `Library JSON must be a string, got ${typeof raw}.`;
  } else {
    try {
      const parsed: unknown = JSON.parse(raw);
      errorMessage = validateParsedLibrary(parsed);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  if (errorMessage !== null) {
    const existing = Array.isArray(data.backupJson) ? data.backupJson : [];
    const last = existing[existing.length - 1];
    const isDuplicate =
      last !== undefined && last.rawLibraryJson === rawSnapshot && last.reason === errorMessage;
    const entry: CorruptBackupEntry = isDuplicate
      ? last
      : {
          id: generateUniqueId('corrupt'),
          timestamp: new Date().toISOString(),
          reason: errorMessage,
          rawLibraryJson: rawSnapshot,
        };
    const nextBackupJson = isDuplicate ? existing : [...existing, entry];
    const nextData: PluginPersistedData = {
      ...data,
      backupJson: nextBackupJson,
      recoveryActive: true,
    };
    await saveData(nextData);
    Object.assign(data, nextData);

    const recovery: RecoveryStateSnapshot = {
      corrupt_path: `obsidian://plugin-data/backupJson/${entry.id}`,
      backup_candidate: fallbackBackup ? 'obsidian://plugin-data/lastValidLibraryJson' : null,
      error: errorMessage,
    };

    return {
      ok: false,
      libraryJson: fallbackBackup ?? DEFAULT_EMPTY_LIBRARY_JSON,
      recovery,
    };
  }

  data.lastValidLibraryJson = raw;
  data.recoveryActive = false;
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
    typeof data.lastValidLibraryJson === 'string' && data.lastValidLibraryJson.trim().length > 0
      ? data.lastValidLibraryJson
      : DEFAULT_EMPTY_LIBRARY_JSON;
  const nextData: PluginPersistedData = {
    ...data,
    libraryJson: restored,
    lastValidLibraryJson: restored,
    recoveryActive: false,
  };
  await saveData(nextData);
  Object.assign(data, nextData);
  return restored;
}

export async function resetEmptyLibrary(
  data: PluginPersistedData,
  saveData: (next: PluginPersistedData) => Promise<void>,
): Promise<string> {
  const nextData: PluginPersistedData = {
    ...data,
    libraryJson: DEFAULT_EMPTY_LIBRARY_JSON,
    lastValidLibraryJson: DEFAULT_EMPTY_LIBRARY_JSON,
    recoveryActive: false,
  };
  await saveData(nextData);
  Object.assign(data, nextData);
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
  if (!isLibraryValidForWrites(data)) {
    throw new Error(
      '存在未解决的配置损坏恢复状态（recovery lock），请先从备份恢复或重置为空配置',
    );
  }
  const snippetSource = source.trim().length > 0 ? source : latex;
  if (!snippetSource.trim()) {
    return readUserFormulas(data);
  }
  const lib = parseLibraryRecord(data.libraryJson);
  const existing = readUserFormulas(data);
  const entry: UserFormulaEntry = {
    id: generateUniqueId(),
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
  const nextData: PluginPersistedData = {
    ...data,
    libraryJson: serialized,
    lastValidLibraryJson: serialized,
    recoveryActive: false,
  };
  await saveData(nextData);
  Object.assign(data, nextData);
  return updated;
}

function toDesktopUserFormulas(entries: UserFormulaEntry[]): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    category: entry.category,
    source: entry.source,
    desc: entry.desc ?? '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    created_at: typeof entry.created_at === 'number' ? entry.created_at : 0,
  }));
}

export function exportPluginConfigJson(
  data: PluginPersistedData,
  currentSettings?: AppSettings,
): string {
  const lib = parseLibraryRecord(data.libraryJson);
  const customFormats = Array.isArray(lib.customFormats)
    ? lib.customFormats
    : Array.isArray(lib.custom_formats)
      ? lib.custom_formats
      : [];
  const overrides = Array.isArray(lib.overrides) ? lib.overrides : [];
  const snippets = readUserFormulas(data);
  return JSON.stringify(
    {
      schema_version: 3,
      settings: currentSettings ?? data.settings ?? createDefaultAppSettings(),
      customFormats,
      custom_formats: customFormats,
      snippets,
      user_formulas: toDesktopUserFormulas(snippets),
      overrides,
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

  let libSource: Record<string, unknown> = obj;
  if ('libraryJson' in obj) {
    if (typeof obj.libraryJson !== 'string') {
      throw new Error('Embedded libraryJson must be a JSON string.');
    }
    const embedded: unknown = JSON.parse(obj.libraryJson);
    if (typeof embedded !== 'object' || embedded === null || Array.isArray(embedded)) {
      throw new Error('Embedded libraryJson must parse to an object.');
    }
    libSource = embedded as Record<string, unknown>;
  }

  const validationErr = validateParsedLibrary(libSource);
  if (validationErr !== null) {
    throw new Error(validationErr);
  }

  const customFormats =
    Array.isArray(libSource.customFormats) && libSource.customFormats.length > 0
      ? libSource.customFormats
      : Array.isArray(libSource.custom_formats) && libSource.custom_formats.length > 0
        ? libSource.custom_formats
        : Array.isArray(libSource.customFormats)
          ? libSource.customFormats
          : Array.isArray(libSource.custom_formats)
            ? libSource.custom_formats
            : [];

  const overrides = Array.isArray(libSource.overrides) ? libSource.overrides : [];

  const snippetItems = Array.isArray(libSource.snippets) ? libSource.snippets : [];
  const userFormulaItems = Array.isArray(libSource.user_formulas) ? libSource.user_formulas : [];
  const legacyFormulaItems = Array.isArray(libSource.formulas) ? libSource.formulas : [];

  const mergedFormulas: UserFormulaEntry[] = [];
  const seenIds = new Set<string>();
  let idxCounter = 0;
  for (const rawItem of [...userFormulaItems, ...snippetItems, ...legacyFormulaItems]) {
    const normalized = normalizeUserFormulaEntry(rawItem, idxCounter);
    idxCounter += 1;
    if (normalized && !seenIds.has(normalized.id)) {
      seenIds.add(normalized.id);
      mergedFormulas.push(normalized);
    }
  }

  const nextLib = {
    schema_version: 3,
    customFormats,
    snippets: mergedFormulas,
    overrides,
  };

  let nextSettings: AppSettings | undefined;
  const settingsRaw = obj.settings ?? libSource.settings;
  if (typeof settingsRaw === 'object' && settingsRaw !== null && !Array.isArray(settingsRaw)) {
    const rawMap = settingsRaw as Record<string, unknown>;
    const defaults = createDefaultAppSettings();
    const shortcutsRaw = rawMap.shortcuts;
    nextSettings = {
      ...defaults,
      ...(rawMap as Partial<AppSettings>),
      delimiter_style:
        typeof rawMap.delimiter_style === 'string'
          ? (rawMap.delimiter_style as AppSettings['delimiter_style'])
          : typeof rawMap.delimiterStyle === 'string'
            ? (rawMap.delimiterStyle as AppSettings['delimiter_style'])
            : defaults.delimiter_style,
      preview_scale_pct:
        typeof rawMap.preview_scale_pct === 'number'
          ? rawMap.preview_scale_pct
          : typeof rawMap.previewScalePct === 'number'
            ? rawMap.previewScalePct
            : defaults.preview_scale_pct,
      render_backend:
        typeof rawMap.render_backend === 'string'
          ? (rawMap.render_backend as AppSettings['render_backend'])
          : typeof rawMap.renderBackend === 'string'
            ? (rawMap.renderBackend as AppSettings['render_backend'])
            : defaults.render_backend,
      shortcuts: {
        ...defaults.shortcuts,
        ...(typeof shortcutsRaw === 'object' && shortcutsRaw !== null && !Array.isArray(shortcutsRaw)
          ? (shortcutsRaw as Partial<AppSettings['shortcuts']>)
          : {}),
      },
    };
  }

  const serialized = JSON.stringify(nextLib);
  const nextData: PluginPersistedData = {
    ...data,
    ...(nextSettings ? { settings: nextSettings } : {}),
    libraryJson: serialized,
    lastValidLibraryJson: serialized,
    recoveryActive: false,
  };
  await saveData(nextData);
  Object.assign(data, nextData);

  return {
    settings: nextSettings,
    libraryJson: serialized,
    userFormulas: readUserFormulas(data),
  };
}
