import { describe, it, expect } from 'vitest';
import { ReflectionAdvisor } from '../src/core/reflection-advisor.js';
import type { CheckpointNode } from '../src/types.js';

describe('ReflectionAdvisor', () => {
  const advisor = new ReflectionAdvisor();

  it('should generate meaningful reflection notes from failed nodes', () => {
    const failedNodes: CheckpointNode[] = [
      {
        id: 'chk_fail_1',
        parentId: 'chk_root',
        branch: 'abandoned-branch',
        turnIndex: 2,
        timestamp: Date.now(),
        prompt: 'Connect to external MySQL',
        summary: 'Failed attempt',
        gitTreeOid: 'tree_oid',
        gitCommitOid: 'commit_oid',
        sessionState: { sessionId: 's1', messages: [] },
        changedFiles: [],
        status: 'failed',
        errorMessage: 'ECONNREFUSED: MySQL port 3306 not available',
        failedTools: [
          { toolName: 'bash', input: 'mysql -u root', error: 'Command not found: mysql' }
        ],
      },
    ];

    const result = advisor.generateReflectionNote(failedNodes);

    expect(result.hasPastFailures).toBe(true);
    expect(result.failedNodeCount).toBe(1);
    expect(result.suggestedPromptPrefix).toContain('[TIME-MACHINE REFLECTION ADVISORY]');
    expect(result.suggestedPromptPrefix).toContain('ECONNREFUSED');
    expect(result.suggestedPromptPrefix).toContain('Command not found: mysql');
    expect(result.suggestedPromptPrefix).toContain('CRITICAL INSTRUCTION: Do NOT repeat');
  });
});
