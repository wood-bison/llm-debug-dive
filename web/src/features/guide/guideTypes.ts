export interface GuideTerm {
  name: string
  meaning: string
  example?: string
}

export interface GuideSection {
  id: string
  title: string
  kind: 'terms' | 'pairs'
  items: readonly GuideTerm[]
}
