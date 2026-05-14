// LLM Debug Dive — client-side dashboard logic
//
// Responsibilities:
//   1. Filter chips (range + runtime/provider) → rewrite hx-get URLs and re-fetch.
//   2. Highlight selected row when a span is clicked.
//   3. Lightweight JSON syntax colorizer in the detail pane after htmx swap.

(() => {
  let currentRange = '1h'
  let currentRuntime = ''

  function setActive(group, value) {
    document.querySelectorAll('.filter-chip[data-' + group + ']').forEach((el) => {
      el.classList.toggle('active', el.dataset[group] === value)
    })
  }

  function applyFilters() {
    const params = new URLSearchParams({ range: currentRange })
    if (currentRuntime) params.set('provider', currentRuntime)
    const qs = '?' + params.toString()

    const targets = ['/api/stats', '/api/traces', '/api/skills', '/api/tools']
    for (const prefix of targets) {
      const el = document.querySelector('[hx-get^="' + prefix + '"]')
      if (!el) continue
      el.setAttribute('hx-get', prefix + qs)
      htmx.process(el)
      htmx.trigger(el, 'load')
    }
  }

  document.querySelectorAll('.filter-chip[data-range]').forEach((el) => {
    el.addEventListener('click', () => {
      currentRange = el.dataset.range
      setActive('range', currentRange)
      applyFilters()
    })
  })

  document.querySelectorAll('.filter-chip[data-runtime]').forEach((el) => {
    el.addEventListener('click', () => {
      currentRuntime = el.dataset.runtime
      setActive('runtime', currentRuntime)
      applyFilters()
    })
  })

  const clearButton = document.querySelector('#clear-db-button')
  if (clearButton) {
    clearButton.addEventListener('click', async () => {
      const ok = window.confirm('Clear all local traces, spans, and tool telemetry from Postgres?')
      if (!ok) return
      clearButton.disabled = true
      clearButton.textContent = 'Clearing…'
      try {
        const res = await fetch('/api/admin/clear', { method: 'POST' })
        if (!res.ok) throw new Error('clear failed')
        const detailPane = document.querySelector('#detail-pane')
        if (detailPane) detailPane.innerHTML = '<div class="detail-empty">Database cleared. Run codex-debug to capture a fresh trace.</div>'
        applyFilters()
      } catch (err) {
        window.alert('Could not clear DB. Check proxy logs.')
      } finally {
        clearButton.disabled = false
        clearButton.textContent = 'Clear DB'
      }
    })
  }

  // A trace row is an index entry. Open the full replay page for real debugging.
  document.body.addEventListener('click', (e) => {
    const row = e.target.closest('tr.span-row, tr.trace-row')
    if (!row) return
    document.querySelectorAll('tr.span-row.selected, tr.trace-row.selected').forEach((r) => r.classList.remove('selected'))
    row.classList.add('selected')
    const traceUrl = row.dataset.traceUrl
    if (traceUrl) window.location.href = traceUrl
  })

  document.body.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-ollama-button]')
    if (!button) return
    e.preventDefault()

    const form = button.closest('[data-ollama-form]')
    const panel = form.closest('.ollama-coach')
    const traceId = panel?.dataset.traceId
    const output = panel?.querySelector('[data-ollama-output]')
    const select = form.querySelector('select[name="model"]')
    if (!traceId || !output || !select) return

    const original = button.textContent
    button.disabled = true
    button.textContent = 'Thinking…'
    output.innerHTML = '<div class="ollama-loading">Local model is reading the trace summary…</div>'

    try {
      const res = await fetch('/api/trace/' + encodeURIComponent(traceId) + '/ollama-coach', {
        method: 'POST',
        body: (() => {
          const data = new FormData()
          data.set('model', select.value)
          return data
        })(),
      })
      const html = await res.text()
      output.innerHTML = html
    } catch (err) {
      output.innerHTML = '<div class="ollama-error">Could not reach Ollama. Check that ollama serve is running.</div>'
    } finally {
      button.disabled = false
      button.textContent = original
    }
  })

  // After htmx replaces the detail pane, colorize any JSON blocks inside it.
  document.body.addEventListener('htmx:afterSwap', (e) => {
    if (e.target.id === 'detail-pane') colorizeJSON(e.target)
  })

  function colorizeJSON(scope) {
    scope.querySelectorAll('pre.json[data-json="true"]').forEach((pre) => {
      let html = pre.textContent
      html = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/("(?:\\.|[^"\\])*"\s*:)/g, '<span class="k">$1</span>')
        .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="s">$1</span>')
        .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="n">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="b">$1</span>')
      pre.innerHTML = html
    })
  }
})()
