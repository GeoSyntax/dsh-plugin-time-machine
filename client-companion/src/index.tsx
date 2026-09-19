import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TimeMachineClient, type CompanionTimelineEntry } from 'dsh-plugin-time-machine/client'
import { useEffect, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

type ActionProps = PropsRuntime<'conversation.session.header.actions'> & {
  client: TimeMachineClient
  openSession: (sessionId: SessionId) => void
}

function TimeMachineAction({ sessionId, client, openSession }: ActionProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<CompanionTimelineEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setBusy(true)
    setError(null)
    void client.timeline(String(sessionId), 20).then((next) => {
      if (active) setRows(next)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [client, open, sessionId])

  async function undo(row: CompanionTimelineEntry): Promise<void> {
    if (!row.canUndo || row.relativeUndo === null) return
    setBusy(true)
    setError(null)
    try {
      const action = await client.preview(String(sessionId), row.checkpoint.id)
      const changed = action.preview.diffs.length
      const conflicts = action.preview.conflictingPaths.length
      const omitted = action.preview.targetOmittedPaths?.length ?? 0
      const details = `\n\n${changed} file change(s), ${conflicts} conflict path(s), ${omitted} omitted path(s).`
      if (!window.confirm(`Rewind ${row.relativeUndo} completed turn(s) to Turn ${row.checkpoint.turnIndex}?${details}`)) return
      const result = await client.rewind(action, {
        merge: action.preview.requiresForce,
      }) as { conversation?: { sessionId?: string } }
      const next = result.conversation?.sessionId
      if (!next) throw new Error('Time Machine did not return a forked session id.')
      openSession(next as SessionId)
      setOpen(false)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <div style={{ position: 'relative' }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>↶ Time Machine</button>
    {open ? <div role="dialog" aria-label="Time Machine timeline" style={{ position: 'absolute', right: 0, zIndex: 10, minWidth: 280, padding: 12, background: 'var(--dsw-alias-surface-primary, #fff)', border: '1px solid var(--dsw-alias-border, #ccc)', borderRadius: 8 }}>
      {busy ? <p>Loading checkpoints…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!busy && rows.length === 0 && !error ? <p>No completed turns available.</p> : null}
      {rows.filter(row => row.userVisible).map(row => <button key={row.checkpoint.id} type="button" disabled={!row.canUndo || busy} onClick={() => { void undo(row) }} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}>
        {row.relativeUndo === 0 ? 'Current' : `Undo ${row.relativeUndo}`} · Turn {row.checkpoint.turnIndex}
        {row.warnings.length ? ` · ⚠ ${row.warnings.join(', ')}` : ''}
      </button>)}
    </div> : null}
  </div>
}

export const inject = ['sessions', 'slots']

export function apply(ctx: ClientContext): void {
  const client = new TimeMachineClient({ baseUrl: window.location.origin })
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'time-machine', order: 30,
  }, (props: PropsRuntime<'conversation.session.header.actions'>) => (
    <TimeMachineAction {...props} client={client} openSession={(id) => { ctx.uiWorkspace.openSession(id) }} />
  )))
}

export { TimeMachineAction }
