/**
 * Renders one conversation message into HTML.
 * Role colour-coded: system=brown, user=olive, assistant=rust, tool=gray.
 */

import type { ConvMessage } from '../db'
import { escapeHtml } from './render'

export function renderConversationMessage(m: ConvMessage): string {
  const roleLabel = m.role.toUpperCase()
  const roleClass = `role-${m.role}`

  const toolsBlock = (m.toolCalls ?? []).map((tc) => {
    const argsStr = typeof tc.input === 'string'
      ? tc.input
      : JSON.stringify(tc.input, null, 2)
    return `<div class="conv-tool">
      <div class="tool-name">→ ${escapeHtml(tc.name)}</div>
      <div class="tool-args">${escapeHtml(argsStr ?? '')}</div>
    </div>`
  }).join('')

  const cacheTag = m.cached
    ? '<span class="pill" style="background:var(--olive-soft);color:var(--olive);font-size:9px">CACHED</span>'
    : ''

  const toolFor = m.toolResultFor
    ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--caption)">for ${escapeHtml(m.toolResultFor.slice(0, 16))}…</span>`
    : ''

  return `<div class="conv-msg ${roleClass}">
    <div class="role">${roleLabel} ${cacheTag} ${toolFor}</div>
    ${m.text ? `<div class="body">${escapeHtml(m.text)}</div>` : ''}
    ${toolsBlock}
  </div>`
}
