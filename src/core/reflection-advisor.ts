import type { CheckpointNode, ExternalEffectRecord, ReflectionSummary } from '../types.js';

export class ReflectionAdvisor {
  /**
   * 分析已放弃或失败的分支节点，提炼结构化反思提示词
   */
  generateReflectionNote(abandonedNodes: CheckpointNode[]): ReflectionSummary {
    if (!abandonedNodes || abandonedNodes.length === 0) {
      return {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: '',
        suggestedPromptPrefix: '',
        hasExternalEffects: false,
        externalEffectCount: 0,
      };
    }

    const failureIncidents: Array<{
      prompt: string;
      errorMsg?: string;
      failedTools?: Array<{ toolName: string; input: any; error: string }>;
    }> = [];
    const externalEffects = abandonedNodes.flatMap(node => node.externalEffects ?? []);

    for (const node of abandonedNodes) {
      if (node.status === 'failed' || node.errorMessage || (node.failedTools && node.failedTools.length > 0)) {
        failureIncidents.push({
          prompt: node.prompt,
          errorMsg: node.errorMessage,
          failedTools: node.failedTools,
        });
      }
    }

    if (failureIncidents.length === 0) {
      const hasEffects = externalEffects.length > 0;
      return {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: hasEffects
          ? `Previous branches declared ${externalEffects.length} external side effect(s); workspace restore does not compensate them.`
          : 'Previous branches explored alternative solutions without logged runtime errors.',
        suggestedPromptPrefix: hasEffects ? externalEffectAdvisory(externalEffects) : '',
        hasExternalEffects: hasEffects,
        externalEffectCount: externalEffects.length,
      };
    }

    // 格式化提炼反思文本
    const lines: string[] = [
      `[TIME-MACHINE REFLECTION ADVISORY]`,
      `You are exploring a new branch after rewinding/forking from a previous attempt.`,
      `The following issues occurred in the prior abandoned branch(es):`,
    ];

    failureIncidents.slice(0, 3).forEach((inc, idx) => {
      lines.push(`  - Attempt ${idx + 1} ("${inc.prompt}"):`);
      if (inc.errorMsg) {
        lines.push(`    Error: ${inc.errorMsg.slice(0, 180)}`);
      }
      if (inc.failedTools && inc.failedTools.length > 0) {
        inc.failedTools.forEach(t => {
          lines.push(`    Failed tool [${t.toolName}]: ${t.error.slice(0, 120)}`);
        });
      }
    });

    if (externalEffects.length > 0) {
      lines.push(`External side effects were declared in abandoned branch(es); filesystem restore does not undo them:`);
      externalEffects.slice(0, 5).forEach(effect => {
        lines.push(`  - [${effect.adapter}] ${effect.operation}: ${effect.reversible ? 'adapter-declared reversible' : 'not declared reversible'}; ${effect.failureSemantics.slice(0, 140)}`);
        if (effect.compensation) lines.push(`    Explicit compensation: ${effect.compensation.slice(0, 160)}`);
      });
      lines.push(`WARNING: verify external state or run the adapter's explicit compensation before relying on this branch.`);
    }

    lines.push(
      `CRITICAL INSTRUCTION: Do NOT repeat the exact approaches or failed commands above. Choose a cleaner, alternative architectural or implementation strategy.`
    );

    const summaryText = lines.join('\n');

    return {
      hasPastFailures: true,
      failedNodeCount: failureIncidents.length,
      summaryNote: `Detected ${failureIncidents.length} failed attempts in alternative branches.`,
      suggestedPromptPrefix: summaryText,
      hasExternalEffects: externalEffects.length > 0,
      externalEffectCount: externalEffects.length,
    };
  }
}

function externalEffectAdvisory(effects: ExternalEffectRecord[]): string {
  const lines = [
    `[TIME-MACHINE EXTERNAL EFFECT WARNING]`,
    `Filesystem/session restore does not automatically undo external database, network, process, or cloud mutations.`,
    `Verify the following declared effects before continuing:`,
  ];
  for (const effect of effects.slice(0, 5)) {
    lines.push(`  - [${effect.adapter}] ${effect.operation}: ${effect.failureSemantics.slice(0, 140)}`);
    if (effect.compensation) lines.push(`    Explicit compensation: ${effect.compensation.slice(0, 160)}`);
  }
  return lines.join('\n');
}
