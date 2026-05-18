export interface CodexLocalTool {
  name: string
  label: string
  input: string | null
}

export interface CodexLocalTurn {
  threadId: string | null
  turnId: string | null
  sessionFile: string | null
  cwd: string | null
  prompt: string | null
  assistant: string | null
  commentary: string[]
  tools: CodexLocalTool[]
}

export type AnalyzableTool = Pick<CodexLocalTool, 'name' | 'label' | 'input'>

export interface CodexTurnStats {
  status: string | null
  model: string | null
  reasoningEffort: string | null
  toolCalls: number | null
  shellCommands: number | null
  fileChanges: number | null
  durationMs: number | null
  threadId: string | null
}

export const CODEX_TURN_EVENT = 'codex_turn_event'
