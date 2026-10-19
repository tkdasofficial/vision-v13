/** A project name is never stored longer than this. */
export const PROJECT_NAME_MAX = 50;

/** Headers show at most this many characters of a project name before cutting it with "...". */
export const PROJECT_NAME_HEADER_MAX = 18;

/** Trim a name to the storable length (counted in whole characters, so emoji stay intact). */
export function clampProjectName(name: string): string {
  return Array.from(name.trim()).slice(0, PROJECT_NAME_MAX).join("");
}

/** Project name as shown in a page header: full name, or the first 18 characters plus "...". */
export function projectHeaderName(name: string): string {
  const characters = Array.from(name);
  return characters.length > PROJECT_NAME_HEADER_MAX
    ? characters.slice(0, PROJECT_NAME_HEADER_MAX).join("") + "..."
    : name;
}
