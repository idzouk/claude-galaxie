import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'galaxie',
  component: 'Pane',
  requestId: 'galaxie',
  props: {
    title: 'Galaxie',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('le panneau se dessine en Raster dans le terminal et en SVG dans l’app, et un outil passe intact', async ($, on) => {
  on('command.register', () => ({ value: { command: 'galaxie' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls', description: 'Liste les fichiers' })
  expect('deny' in ran && ran.deny).toBeFalsy()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'vue' })).toBeDefined()

  const step = await $.tool.call({
    tool: 'mcp__galaxie__etapes',
    demande: 'Vérifier le devis',
    etapes: [{ titre: 'Lire le devis', statut: 'fait' }, { titre: 'Vérifier le site', statut: 'en_cours' }],
  })
  expect(step.text ?? JSON.stringify(step.result)).toContain('1/2')
  await ui.unmount()

  const other = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await other.find({ type: 'Text', text: /Vérifier le site/ })).toBeDefined()
  expect(await other.find({ type: 'Svg' })).toBeDefined()
  await other.unmount()
})
