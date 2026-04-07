/** Escape special regex characters in a string for safe use in `new RegExp()`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
