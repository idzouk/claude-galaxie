export type Kind = 'lecture' | 'commande' | 'web' | 'ecriture' | 'runway' | 'autre'

export type FeedItem = {
  id: string
  label: string
  kind: Kind
  start: number
  end?: number
  ok?: boolean
  seeded?: boolean
}

export type LastTurn = { from: number; ms: number }

export type StepStatus = 'fait' | 'en_cours' | 'a_faire'
export type Step = { titre: string; statut: StepStatus; depuis?: number }
export type Plan = { demande: string; etapes: Step[]; maj: number }

declare module 'claude-code' {
  interface PluginState {
    galaxie: { feed: FeedItem[]; lastTurn: LastTurn; plan: Plan }
  }
}
