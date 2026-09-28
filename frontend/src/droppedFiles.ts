/** Flatten a drop into files; dropped folders are read one level deep. */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .map((item) =>
      "webkitGetAsEntry" in item ? item.webkitGetAsEntry() : null,
    )
    .filter((entry): entry is FileSystemEntry => entry != null);
  if (entries.length === 0 || !entries.some((entry) => entry.isDirectory)) {
    return Array.from(transfer.files);
  }
  const files: File[] = [];
  const readEntry = (entry: FileSystemEntry, depth: number): Promise<void> =>
    new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file((file) => {
          files.push(file);
          resolve();
        }, () => resolve());
      } else if (entry.isDirectory && depth < 2) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        reader.readEntries((children) => {
          void Promise.all(
            children.map((child) => readEntry(child, depth + 1)),
          ).then(() => resolve());
        }, () => resolve());
      } else {
        resolve();
      }
    });
  await Promise.all(entries.map((entry) => readEntry(entry, 0)));
  return files;
}
