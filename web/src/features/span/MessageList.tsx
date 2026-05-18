import type { SpanDetail } from '@contracts/api'

type Message = SpanDetail['messages'][number]

const ROLE_STYLE: Record<Message['role'], { label: string; tone: string }> = {
  system: { label: 'System', tone: 'text-write' },
  user: { label: 'User', tone: 'text-fresh' },
  assistant: { label: 'Assistant', tone: 'text-output' },
  tool: { label: 'Tool result', tone: 'text-cache' },
}
const MESSAGE_PREVIEW_CHARS = 1600

export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-ink-soft">No structured messages could be read from this call. The raw request and response are below.</p>
  }
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Conversation</h3>
      <ol className="grid gap-2">
        {messages.map((message, index) => <MessageItem key={index} message={message} />)}
      </ol>
    </section>
  )
}

function MessageItem({ message }: { message: Message }) {
  const style = ROLE_STYLE[message.role]
  const long = message.text.length > MESSAGE_PREVIEW_CHARS
  return (
    <li className="min-w-0 rounded-lg border border-line bg-surface p-3 [overflow-wrap:anywhere]">
      <p className={`mb-1 text-xs font-medium ${style.tone}`}>{style.label}{message.cached ? ', served from cache' : ''}</p>
      {message.text && (long ? (
        <details>
          <summary className="cursor-pointer list-none whitespace-pre-wrap text-sm">{message.text.slice(0, MESSAGE_PREVIEW_CHARS)}… <span className="text-focus">Show all</span></summary>
          <p className="whitespace-pre-wrap text-sm">{message.text.slice(MESSAGE_PREVIEW_CHARS)}</p>
        </details>
      ) : <p className="whitespace-pre-wrap text-sm">{message.text}</p>)}
      {message.toolCalls.map((call, index) => (
        <div key={index} className="mt-2 rounded-md bg-sunken p-2">
          <p className="text-xs font-medium">Calls {call.name}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-soft">{call.input}</pre>
        </div>
      ))}
    </li>
  )
}
