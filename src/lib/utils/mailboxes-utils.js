/**
 * Helper function to collect folder paths that need to be created
  * @param folders
 * @param separator
 * @returns {Set<any>}
 */
export function collectFoldersToCreate(folders, separator) {
    const foldersToCreate = new Set();
    for (const folder of folders) {
        const parts = folder.split(/[/\\.]|\\+/); // allow to split by . or by / or by \
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            // Skip empty parts to avoid creating invalid folder paths
            if (part === '') {
                continue;
            }
            currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
            foldersToCreate.add(currentPath);
        }
    }
    return foldersToCreate;
}
