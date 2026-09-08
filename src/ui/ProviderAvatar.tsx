import claude from '../assets/claude.gif';
import codex from '../assets/codex.png';
import openclaw from '../assets/openclaw-mascot.svg';
import type { Agent } from '../types/agent.js';
export function ProviderAvatar({ agent }: { agent: Agent }) {
  const isOpenClaw = /openclaw/i.test(`${agent.sourceName || ''} ${agent.machineName || ''}`);
  return <span className={`provider-avatar provider-${agent.provider}`} aria-hidden="true">
    {agent.provider === 'webhook' && !isOpenClaw ? <span className="webhook-avatar">{agent.sourceType === 'ci' ? 'CI' : 'W'}</span> : <img src={agent.provider === 'claude' ? claude : agent.provider === 'codex' ? codex : openclaw} alt="" />}
    {agent.provider === 'claude' && <span className="still-avatar">C</span>}
  </span>;
}
