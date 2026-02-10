import { useEffect, useRef } from 'react';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { spritePositions } from '../engine/AgentSprite.js';
import type { AgentState } from '../types/agent.js';

const STATE_COLORS: Record<string, string> = {
  thinking: '#7c4dff',
  terminal: '#2ee65e',
  searching: '#ffa726',
  coding: '#42a5f5',
  reading: '#42a5f5',
  error: '#ff4444',
  waiting: '#ffeb3b',
  cooling: '#90a4ae',
  delegating: '#ce93d8',
};

function getBubbleStyle(state: AgentState, waitingForHuman: boolean) {
  if (waitingForHuman) {
    return { background: '#ffeb3b', color: '#000' };
  }
  const bg = STATE_COLORS[state] ?? '#555';
  const dark = state === 'waiting';
  return { background: bg, color: dark ? '#000' : '#fff' };
}

export function BubbleOverlay({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const agents = useOfficeStore((s) => s.agents);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (canvas && overlay) {
        const rect = canvas.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const offsetX = rect.left - overlayRect.left;
        const offsetY = rect.top - overlayRect.top;
        const scaleX = rect.width / 320;
        const scaleY = rect.height / 240;

        for (const child of overlay.children) {
          const el = child as HTMLElement;
          const id = el.dataset.agentId;
          if (!id) continue;
          const pos = spritePositions.get(id);
          if (pos) {
            el.style.left = `${offsetX + pos.x * scaleX}px`;
            el.style.top = `${offsetY + (pos.y - 20) * scaleY}px`;
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [canvasRef]);

  const agentList = Array.from(agents.values());

  return (
    <div ref={overlayRef} className="bubble-overlay">
      {agentList.map((agent) => {
        let text: string | null = null;
        if (agent.waitingForHuman) {
          text = 'Waiting for you';
        } else if (agent.activityText) {
          text = agent.activityText.length > 25
            ? agent.activityText.slice(0, 24) + '\u2026'
            : agent.activityText;
        }
        if (!text) return null;

        const style = getBubbleStyle(agent.state, agent.waitingForHuman);

        return (
          <div
            key={agent.id}
            data-agent-id={agent.id}
            className="speech-bubble"
            style={{ background: style.background, color: style.color }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}
