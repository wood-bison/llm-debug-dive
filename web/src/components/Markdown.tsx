import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const REMARK_PLUGINS = [remarkGfm]
const UNSAFE_SCHEMES = /^(javascript|vbscript|data):/i

export function safeUrl(url: string): string {
  return UNSAFE_SCHEMES.test(url.trim()) ? '#' : url
}

const components: Components = {
  a: ({ href, children }) => <a href={safeUrl(href ?? '#')} className="text-focus underline underline-offset-2" rel="noreferrer noopener" target="_blank">{children}</a>,
  code: ({ children }) => <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-line-strong px-2 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-2 py-1.5 align-top">{children}</td>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-sunken p-4 font-mono text-[13px] [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-answer grid gap-3 leading-relaxed [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_table]:w-full [&_td]:border-t [&_td]:border-line [&_td]:py-1 [&_th]:text-left [&_ul]:list-disc">
      <ReactMarkdown components={components} remarkPlugins={REMARK_PLUGINS} skipHtml urlTransform={safeUrl}>{children}</ReactMarkdown>
    </div>
  )
}
