/** Keep the complete generated input available while opening its preview at
 * the first PQ setting. The returned line number is from the original file. */
export function compactInputPreview(
  input: string,
  showHeader: boolean,
): { text: string; firstLine: number; headerHidden: boolean } {
  const lines = input.split("\n");
  const jobtypeLine = lines.findIndex((line) => /^\s*jobtype\s*=/.test(line));
  const firstIndex = jobtypeLine > 1 ? jobtypeLine - 1 : 0;
  if (showHeader || firstIndex === 0) {
    return { text: input, firstLine: 1, headerHidden: false };
  }
  return {
    text: lines.slice(firstIndex).join("\n"),
    firstLine: firstIndex + 1,
    headerHidden: true,
  };
}
