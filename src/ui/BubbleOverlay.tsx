import { Fragment, useEffect, useRef, useState } from 'react';
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

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec.toString().padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin.toString().padStart(2, '0')}m`;
}

function getTimeColor(ms: number, state: AgentState): string {
  const isIdleOrWaiting = state === 'waiting' || state === 'idle' || state === 'cooling';
  if (ms > 5 * 60 * 1000 && isIdleOrWaiting) return '#ff4444'; // red: >5min idle/waiting
  if (ms > 5 * 60 * 1000) return '#ffa726'; // orange: >5min active
  if (ms > 60 * 1000) return '#ffeb3b'; // yellow: 1-5min
  return '#31e678'; // green: <1min
}

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
  const [now, setNow] = useState(Date.now());

  // Tick every second to update elapsed time displays
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
            const yOffset = Number(el.dataset.offsetY ?? -20);
            el.style.left = `${offsetX + pos.x * scaleX}px`;
            el.style.top = `${offsetY + (pos.y + yOffset) * scaleY}px`;
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

        const elapsed = now - agent.stateChangedAt;
        const showTimer = elapsed >= 10_000 && agent.state !== 'entering' && agent.state !== 'leaving';
        const style = getBubbleStyle(agent.state, agent.waitingForHuman);
        const nameLabel = agent.name || agent.id.slice(0, 6);

        return (
          <Fragment key={agent.id}>
            {(text || showTimer) ? (
              <div
                data-agent-id={agent.id}
                data-offset-y="-20"
                className="speech-bubble"
                style={{ background: style.background, color: style.color }}
              >
                {text && <div>{text}</div>}
                {showTimer && (
                  <div
                    className="time-indicator"
                    style={{ color: getTimeColor(elapsed, agent.state) }}
                  >
                    {formatElapsed(elapsed)}
                  </div>
                )}
              </div>
            ) : null}
            <div
              data-agent-id={agent.id}
              data-offset-y="16"
              className="sprite-label"
            >
              {nameLabel}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
