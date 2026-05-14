/**
 * Static HTML templates for the two pages we serve:
 *   - /dashboard          → main live feed
 *   - /dashboard/trace/:id → trace conversation view
 *
 * Both link to /static/styles.css and /static/app.js for CSS/JS,
 * keeping the TS files free of inline frontend code.
 */

export const DASHBOARD_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#2D3B2D">
<title>LLM Debug Dive</title>
<link rel="icon" href="/static/favicon.svg?v=20260516" type="image/svg+xml">
<link rel="shortcut icon" href="/static/favicon.svg?v=20260516" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css">
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
</head>
<body>
<div class="wrapper">

  <header>
    <div class="header-line">
      <div>
        <div class="eyebrow">LLM Debug Dive</div>
        <h1>Live proxy dashboard</h1>
        <div class="subtitle">
          <span class="live-dot"></span>
          local proxy · auto-refresh every 2 s · Postgres on <code>:55432</code>
        </div>
      </div>
      <div class="header-actions">
        <a class="nav-button" href="/dashboard/guide" title="Open the LLM debugging glossary and usage guide">Guide</a>
        <button class="danger-button" id="clear-db-button" type="button" title="Delete local traces, spans, and tool telemetry from Postgres">
          Clear DB
        </button>
      </div>
    </div>
  </header>

  <div class="filters">
    <span class="filter-label">range</span>
    <span class="filter-chip" data-range="15m">15m</span>
    <span class="filter-chip active" data-range="1h">1h</span>
    <span class="filter-chip" data-range="24h">24h</span>
    <span class="filter-chip" data-range="7d">7d</span>
    <div class="filter-divider"></div>
    <span class="filter-label">runtime</span>
    <span class="filter-chip active" data-runtime="">all</span>
    <span class="filter-chip" data-runtime="chatgpt" title="Codex with ChatGPT auth backend">codex/chatgpt</span>
    <span class="filter-chip" data-runtime="openai" title="OpenAI API-compatible traffic">openai api</span>
    <span class="filter-chip" data-runtime="anthropic" title="Anthropic API-compatible traffic">anthropic</span>
    <span class="filter-chip" data-runtime="google" title="Google/Gemini API-compatible traffic">google</span>
    <span class="filter-chip disabled" title="Planned: Ollama, vLLM, llama.cpp, or other local OpenAI-compatible runtimes">local</span>
  </div>

  <section class="terms-strip" aria-label="Production observability terms">
    <div class="term-card">
      <div class="term-name">Agent</div>
      <div class="term-copy">program that calls an LLM and tools to complete work</div>
    </div>
    <div class="term-card">
      <div class="term-name">Trace</div>
      <div class="term-copy">one user turn across model calls, tools, cache, and result</div>
    </div>
    <div class="term-card">
      <div class="term-name">Span</div>
      <div class="term-copy">one captured operation inside a trace: LLM, tool, API, telemetry</div>
    </div>
    <div class="term-card">
      <div class="term-name">Signals</div>
      <div class="term-copy">token load, cache hit, latency, failures, repeated work</div>
    </div>
    <div class="term-card">
      <div class="term-name">Scoring</div>
      <div class="term-copy">turn verdict: efficient, cold-cache, context-heavy, failed</div>
    </div>
    <div class="term-card">
      <div class="term-name">Evals</div>
      <div class="term-copy">repeatable checks that compare agent behavior across runs</div>
    </div>
    <div class="term-card">
      <div class="term-name">Monitors</div>
      <div class="term-copy">production alerts for cost, errors, loops, and regressions</div>
    </div>
  </section>

  <div class="stats"
       hx-get="/api/stats?range=1h"
       hx-trigger="load, every 5s"
       hx-swap="innerHTML">
    <div class="stat"><div class="stat-label">loading…</div></div>
  </div>

  <div class="skills-tools">
    <div class="card st-card">
      <div class="card-header">
        <div>
          <div class="card-title">Workflow groups</div>
          <div class="card-meta">Human labels for what the agent spent tool work on</div>
        </div>
        <a class="card-help" href="/dashboard/guide#signals" title="Open guide">?</a>
      </div>
      <div id="skills-list"
           hx-get="/api/skills?range=1h"
           hx-trigger="load, every 5s"
           hx-swap="innerHTML"
           class="st-list"><div class="st-empty">loading…</div></div>
    </div>
    <div class="card st-card">
      <div class="card-header">
        <div>
          <div class="card-title">Raw tools</div>
          <div class="card-meta">Actual commands and MCP/browser/file operations captured</div>
        </div>
        <a class="card-help" href="/dashboard/guide#signals" title="Open guide">?</a>
      </div>
      <div id="tools-list"
           hx-get="/api/tools?range=1h"
           hx-trigger="load, every 5s"
           hx-swap="innerHTML"
           class="st-list"><div class="st-empty">loading…</div></div>
    </div>
  </div>

  <div class="grid dashboard-grid-full">
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Recent traces · click any row to open full replay</div>
          <div class="card-meta">The live table is only the index. Detailed debugging lives on the full-width trace page.</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>when</th>
            <th>runtime</th>
            <th>prompt</th>
            <th class="r">calls</th>
            <th class="r">tokens</th>
            <th>tools</th>
            <th class="r">latency</th>
            <th class="r">cost</th>
          </tr>
        </thead>
        <tbody id="traces-body"
               hx-get="/api/traces?range=1h"
               hx-trigger="load, every 2s"
               hx-swap="innerHTML">
          <tr><td colspan="9" style="padding:40px;text-align:center;color:var(--caption)">loading…</td></tr>
        </tbody>
      </table>
    </div>

    <aside class="detail-pane dashboard-detail-hidden" id="detail-pane">
      <div class="detail-empty">Open a trace row for full replay</div>
    </aside>
  </div>

</div>

<script src="/static/app.js"></script>
</body>
</html>`

export const GUIDE_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#2D3B2D">
<title>Guide — LLM Debug Dive</title>
<link rel="icon" href="/static/favicon.svg?v=20260516" type="image/svg+xml">
<link rel="shortcut icon" href="/static/favicon.svg?v=20260516" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="guide-page">
<div class="guide-shell">
  <nav class="guide-topbar">
    <a href="/dashboard" class="back">← dashboard</a>
    <div class="rail-brand">LLM Debug Dive</div>
  </nav>

  <header class="guide-hero">
    <div>
      <div class="eyebrow">Reference</div>
      <h1>LLM Debugging Guide</h1>
    </div>
  </header>

  <section class="guide-section" id="signals">
    <div class="guide-section-head">
      <span>01</span>
      <h2>Базовые сущности</h2>
    </div>
    <div class="guide-grid">
      ${guideTerm('Agent', 'Программа, которая делает запросы в LLM и может вызывать tools.', 'Codex, Claude Code, свой backend-agent, LangChain/LangGraph agent.')}
      ${guideTerm('Trace', 'Один рабочий запуск: user prompt → model calls → tools → итоговый ответ.', 'Если ты спросил “проверь PR”, весь этот turn должен стать одним trace.')}
      ${guideTerm('Span', 'Одна операция внутри trace.', 'LLM request, вызов shell/tool, browser check, telemetry event, failed request.')}
      ${guideTerm('Tool', 'Внешнее действие агента вне модели.', 'read file, grep/rg, run tests, browser snapshot, apply_patch, MCP tool.')}
      ${guideTerm('Skill', 'Инструкция или workflow, который учит агента делать конкретный тип задачи.', 'Например: Playwright UI testing skill, code review skill, docs migration skill.')}
      ${guideTerm('Run / Turn', 'Один диалоговый шаг агента по твоему prompt.', 'В Codex это часто один user message и финальный assistant answer.')}
    </div>
  </section>

  <section class="guide-section">
    <div class="guide-section-head">
      <span>02</span>
      <h2>Токены и деньги</h2>
    </div>
    <div class="guide-grid">
      ${guideTerm('Input tokens', 'Контекст, который модель прочитала.', 'Сюда попадает твой prompt, история, системные инструкции, найденные файлы, результаты tools.')}
      ${guideTerm('Output tokens', 'Текст, который модель сгенерировала.', 'Финальный ответ, reasoning output, промежуточные сообщения, если провайдер их считает.')}
      ${guideTerm('Fresh input', 'Новый контекст, который не был взят из cache.', 'Обычно дороже cache reads. Если fresh input огромный, агент много нового загрузил.')}
      ${guideTerm('Cache reads', 'Повторно использованный контекст.', 'Хорошо, когда cache hit высокий, но большой fresh input всё равно может быть дорогим.')}
      ${guideTerm('Cache hit', 'Доля input, которая пришла из cache.', 'Высокий cache hit не значит “бесплатно”; он значит “часть контекста переиспользована”.')}
      ${guideTerm('Cost signal', 'Оценка стоимости или token load, если цена модели неизвестна.', 'Если pricing не настроен, приложение честно показывает token load вместо фейковой точной цены.')}
    </div>
  </section>

  <section class="guide-section">
    <div class="guide-section-head">
      <span>03</span>
      <h2>Scoring, evals, signals, monitors</h2>
    </div>
    <div class="guide-grid">
      ${guideTerm('Scoring', 'Оценка trace по правилам.', 'Например: много fresh input, 25 tools, file-discovery x11 → prompt needs rewrite. Это сигнал, не абсолютная истина.')}
      ${guideTerm('Signals', 'Сырые признаки поведения агента.', 'Tokens, latency, cache, failed spans, repeated tools, edits without verification.')}
      ${guideTerm('Evals', 'Повторяемые проверки качества агента.', 'Например: “для MCP skill агент должен найти .mcp.json за ≤5 tool calls”.')}
      ${guideTerm('Production monitors', 'Автоматические алерты на плохие сигналы.', 'Cost spike, low cache hit, repeated failures, too many tools, missing verification after edits.')}
      ${guideTerm('Verdict', 'Человеческая интерпретация signals.', 'Efficient prompt, usable but tune it, expensive, needs rewrite.')}
      ${guideTerm('Baseline', 'Нормальный уровень для похожих задач.', 'Если обычный docs lookup стоит 40k tokens, а этот trace 985k, значит что-то пошло широко.')}
    </div>
  </section>

  <section class="guide-section">
    <div class="guide-section-head">
      <span>04</span>
      <h2>Как понять, где затык</h2>
    </div>
    <div class="guide-diagnosis">
      <div>
        <b>Много fresh input</b>
        <p>Агент загрузил слишком много нового контекста. Дай точные файлы, запрети широкий поиск, попроси stop after evidence.</p>
      </div>
      <div>
        <b>Много одинаковых tools</b>
        <p>Skill или prompt не дал хорошую search recipe. Если <code>file-discovery</code> или <code>grep</code> повторяются, надо сузить путь.</p>
      </div>
      <div>
        <b>Нет tools, но токенов много</b>
        <p>Ответ мог быть из старого контекста, без свежей проверки. Попроси inspect exact files and cite evidence.</p>
      </div>
      <div>
        <b>Есть edits, но нет verify</b>
        <p>Опасно. Для code changes нужен минимальный test/build/browser check и явный результат.</p>
      </div>
      <div>
        <b>Cache hit высокий, а cost всё равно большой</b>
        <p>Cache помог, но общий context load всё ещё огромный. Нужно уменьшать fresh input и лишние tool outputs.</p>
      </div>
      <div>
        <b>Failed spans</b>
        <p>Сначала чини transport/auth/runtime. Иначе агент может ретраить и тратить токены на обход ошибки.</p>
      </div>
    </div>
  </section>

  <section class="guide-section">
    <div class="guide-section-head">
      <span>05</span>
      <h2>Где тут внешние продукты</h2>
    </div>
    <div class="guide-products">
      <div>
        <b>Google Agent SDK / ADK, OpenAI Agents SDK</b>
        <p>Фреймворки для построения agents. Они помогают организовать tools, memory, tracing, evals, но сами по себе не объясняют твой ежедневный Codex workflow.</p>
      </div>
      <div>
        <b>OpenAI debugger / provider dashboards</b>
        <p>Полезны для API-level observability: requests, latency, usage, errors. Наш dashboard нужен ближе к developer workflow: prompt, tools, skills, replay.</p>
      </div>
      <div>
        <b>LangChain / LangGraph / LangSmith</b>
        <p>Хороши, когда ты пишешь своё приложение с agents. Для локального Codex/Claude-debug нам важнее lightweight capture и понятная интерпретация.</p>
      </div>
      <div>
        <b>Langfuse / Phoenix</b>
        <p>Сильные observability tools, но требуют правильной интеграции и credentials. Здесь они не обязательны: сначала локальный trace должен быть понятным сам по себе.</p>
      </div>
    </div>
  </section>

  <section class="guide-section guide-prompt">
    <div class="guide-section-head">
      <span>06</span>
      <h2>Шаблон дешёвого prompt</h2>
    </div>
    <pre>Goal: &lt;one concrete outcome&gt;
Inspect only:
- &lt;exact file/path/url&gt;
- &lt;exact config/skill&gt;
Boundaries:
- Read-only diagnosis. Do not edit files.
- Do not do broad repo discovery unless listed targets are missing.
- Stop after the smallest evidence set.
Return exactly:
1. finding
2. evidence
3. cheapest fix
4. verification
5. risks</pre>
  </section>
</div>
<script src="/static/app.js"></script>
</body>
</html>`

function guideTerm(title: string, body: string, example: string): string {
  return `<article class="guide-term">
    <h3>${title}</h3>
    <p>${body}</p>
    <span>${example}</span>
  </article>`
}

export function tracePageShell(title: string, body: string, bodyClass = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#2D3B2D">
<title>${title}</title>
<link rel="icon" href="/static/favicon.svg?v=20260516" type="image/svg+xml">
<link rel="shortcut icon" href="/static/favicon.svg?v=20260516" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="${bodyClass}">
<div class="${bodyClass === 'trace-page' ? '' : 'wrapper'}">
${body}
</div>
<script src="/static/app.js"></script>
</body>
</html>`
}
