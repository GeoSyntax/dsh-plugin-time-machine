globalThis.window = { location: { origin: 'http://127.0.0.1:1234' } }

const { apply } = await import('../lib/index.js')
const injected = []
const context = {
  slots: {
    inject(name, factory) {
      injected.push({ name, factory })
    },
  },
  uiWorkspace: { openSession() {} },
}

apply(context)
const names = injected.map(entry => entry.name)
for (const expected of ['conversation.session.header.actions', 'conversation.chat.assistant-actions']) {
  if (!names.includes(expected)) throw new Error(`missing slot: ${expected}`)
}
console.log(`companion slot registration ok (${names.join(', ')})`)
