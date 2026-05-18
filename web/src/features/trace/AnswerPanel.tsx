import { Markdown } from '@web/components/Markdown'
import { Panel } from '@web/components/Panel'

export function AnswerPanel({ answer }: { answer: string }) {
  return (
    <Panel title="Final answer" description="What the agent replied at the end of the run">
      <div className="max-w-3xl text-[15px]">
        <Markdown>{answer}</Markdown>
      </div>
    </Panel>
  )
}
