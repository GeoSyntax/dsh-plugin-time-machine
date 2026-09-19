globalThis.window = { location: { origin: 'http://127.0.0.1:1234' } }

const { apply } = await import('../lib/index.js')
let injected
const context = {
  slots: {
    inject(name, factory) {
      injected = { name, factory }
    },
  },
  uiWorkspace: { openSession() {} },
}

apply(context)
if (injected?.name !== 'conversation.session.header.actions') {
  throw new Error(`unexpected slot: ${injected?.name ?? '<none>'}`)
}
console.log('companion slot registration ok')
