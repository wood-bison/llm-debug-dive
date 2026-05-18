import { expect, test } from 'bun:test'
import { Glob } from 'bun'
import ts from 'typescript'
import { dirname, relative, resolve } from 'node:path'

const SOURCE_PATTERNS = ['src/**/*.ts', 'src/**/*.tsx', 'web/**/*.ts', 'web/**/*.tsx', 'scripts/*', 'test/**/*.ts', 'eslint.config.js']

test('application source has no explicit any', async () => {
  const offenders: string[] = []
  for (const pattern of ['src/**/*.ts', 'web/src/**/*.ts', 'web/src/**/*.tsx']) {
    for await (const file of new Glob(pattern).scan('.')) {
      const text = await Bun.file(file).text()
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          offenders.push(`${file}:${line + 1}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  expect(offenders).toEqual([])
})

test('application and tooling source has no comments', async () => {
  const files = new Set<string>()
  for (const pattern of SOURCE_PATTERNS) {
    for await (const file of new Glob(pattern).scan('.')) files.add(file)
  }

  const offenders: string[] = []
  for (const file of files) {
    const text = await Bun.file(file).text()
    if (file.endsWith('.sh') || !file.includes('.')) {
      text.split('\n').forEach((line, index) => {
        if (line.startsWith('#!') && index === 0) return
        if (/^\s*#/.test(line)) offenders.push(`${file}:${index + 1}`)
      })
      continue
    }

    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const ranges = new Map<number, number>()
    const visit = (node: ts.Node): void => {
      for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) ranges.set(range.pos, range.end)
      for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) ranges.set(range.pos, range.end)
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (ranges.size > 0) offenders.push(`${file}:${ranges.size}`)
  }

  expect(offenders).toEqual([])
})

test('layered source imports only point toward inner layers', async () => {
  const allowed: Record<string, string[]> = {
    shared: [],
    domain: ['shared'],
    application: ['domain', 'shared'],
    infrastructure: ['application', 'domain', 'shared'],
    presentation: ['application', 'contracts', 'domain', 'shared'],
    contracts: [],
  }
  const violations: string[] = []

  for await (const file of new Glob('src/**/*.ts').scan('.')) {
    const sourceLayer = file.split('/')[1]
    if (!sourceLayer || !allowed[sourceLayer]) continue

    const text = await Bun.file(file).text()
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier)) continue
      if (!specifier.text.startsWith('.')) {
        if (sourceLayer === 'domain' || sourceLayer === 'shared') {
          violations.push(`${file} -> external:${specifier.text}`)
        }
        continue
      }

      const target = resolve(dirname(file), specifier.text)
      const targetPath = relative(resolve('src'), target).replaceAll('\\', '/')
      const targetLayer = targetPath.split('/')[0]
      if (targetPath.startsWith('..') || !targetLayer || targetLayer === sourceLayer) continue
      if (!allowed[sourceLayer].includes(targetLayer)) {
        violations.push(`${file} -> src/${targetPath}`)
      }
    }
  }

  expect(violations).toEqual([])
})

test('maintained source and documentation use English text', async () => {
  const offenders: string[] = []
  const patterns = [...SOURCE_PATTERNS, 'web/src/**/*.css', 'docs/**/*.md', 'README.md']
  for (const pattern of patterns) {
    for await (const file of new Glob(pattern).scan('.')) {
      const text = await Bun.file(file).text()
      if (/\p{Script=Cyrillic}/u.test(text)) offenders.push(file)
    }
  }
  expect(offenders).toEqual([])
})
