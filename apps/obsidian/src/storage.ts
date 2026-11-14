import type { AppSettings, RecoveryStateSnapshot } from '@mathslot/ui';

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
