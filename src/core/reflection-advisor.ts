import type { CheckpointNode, ReflectionSummary } from '../types.js';

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
      };
    }

    const failureIncidents: Array<{
      prompt: string;
      errorMsg?: string;
      failedTools?: Array<{ toolName: string; input: any; error: string }>;
    }> = [];

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
      return {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: 'Previous branches explored alternative solutions without logged runtime errors.',
        suggestedPromptPrefix: '',
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

    lines.push(
      `CRITICAL INSTRUCTION: Do NOT repeat the exact approaches or failed commands above. Choose a cleaner, alternative architectural or implementation strategy.`
    );

    const summaryText = lines.join('\n');

    return {
      hasPastFailures: true,
      failedNodeCount: failureIncidents.length,
      summaryNote: `Detected ${failureIncidents.length} failed attempts in alternative branches.`,
      suggestedPromptPrefix: summaryText,
    };
  }
}
