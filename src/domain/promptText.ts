const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const INJECTED_PREFIXES: readonly string[] = [
  '<system-reminder>',
  '<command-name>',
  '<local-command-stdout>',
  "The following is the user's CLAUDE.md",
]

export function userVisibleText(text: string): string {
  const stripped = text.replace(SYSTEM_REMINDER_RE, '').trim()
  return INJECTED_PREFIXES.some((prefix) => stripped.startsWith(prefix)) ? '' : stripped
}
