/**
 * Splits a delimiter-neutral configured folder path into its individual
 * segments, treating `.`, `/` and `\` as equivalent hierarchy separators
 * and dropping empty segments (e.g. from a leading/trailing/doubled separator).
 * @param folder - Delimiter-neutral folder path, e.g. "INBOX.scanner.train.spam"
 * @returns - Non-empty path segments, e.g. ["INBOX", "scanner", "train", "spam"]
 */
export function splitFolderParts(folder: string): string[] {
  return folder.split(/[/\\.]|\\+/).filter(part => part !== ''); // allow to split by . or by / or by \
}

/**
 * Helper function to collect folder paths that need to be created
 * @param folders
 * @param separator
 */
export function collectFoldersToCreate(
  folders: string[],
  separator: string
): Set<string> {
  const foldersToCreate = new Set<string>();
  for (const folder of folders) {
    const parts = splitFolderParts(folder);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
      foldersToCreate.add(currentPath);
    }
  }
  return foldersToCreate;
}
