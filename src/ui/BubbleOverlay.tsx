import { Fragment, useEffect, useRef, useState } from 'react';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { spritePositions, supervisorCheckIns, worldTransform } from '../engine/AgentSprite.js';
import type { Agent, AgentState } from '../types/agent.js';
import { STATE_COLORS } from './stateLabels.js';

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

const TEAM_PASSIVE_STATES = new Set<AgentState>(['cooling', 'idle', 'waiting', 'delegating']);
const RESULT_FLASH_DURATION = 3000; // ms

/** Track child departures to show "Result from X!" flash */
interface ResultFlash {
  childName: string;
  expiresAt: number;
}

function getActiveChildCount(agent: Agent, allAgents: Map<string, Agent>): number {
  return agent.childIds.filter((cid) => allAgents.has(cid)).length;
}

export function BubbleOverlay({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const agents = useOfficeStore((s) => s.agents);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  // Track result flashes per supervisor agent ID
  const resultFlashesRef = useRef<Map<string, ResultFlash>>(new Map());
  // Track previous child sets to detect departures
  const prevChildSetsRef = useRef<Map<string, Set<string>>>(new Map());

  // Tick every second to update elapsed time displays
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Detect child session departures to trigger "Result from X!" flashes
  useEffect(() => {
    const currentTime = Date.now();
    const prevSets = prevChildSetsRef.current;
    const flashes = resultFlashesRef.current;

    for (const [agentId, agent] of agents.entries()) {
      if (agent.childIds.length === 0 && !prevSets.has(agentId)) continue;
      const currentChildren = new Set(agent.childIds.filter((cid) => agents.has(cid)));
      const prevChildren = prevSets.get(agentId);

      if (prevChildren) {
        // Check for children that disappeared (session ended)
        for (const prevChildId of prevChildren) {
          if (!currentChildren.has(prevChildId)) {
            // Child departed — create flash
            const childAgent = agents.get(prevChildId);
            const childName = childAgent?.name ?? childAgent?.roleName ?? prevChildId.slice(0, 6);
            flashes.set(agentId, {
              childName,
              expiresAt: currentTime + RESULT_FLASH_DURATION,
            });
          }
        }
      }
      prevSets.set(agentId, currentChildren);
    }

    // Clean up flashes that expired
    for (const [agentId, flash] of flashes.entries()) {
      if (flash.expiresAt <= currentTime) {
        flashes.delete(agentId);
      }
    }
  }, [agents, now]);

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (spritePositions.size === 0) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      if (canvas && overlay) {
        const rect = canvas.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const offsetX = rect.left - overlayRect.left;
        const offsetY = rect.top - overlayRect.top;
        // Account for the world container's transform (follow-mode zoom/pan)
        const wt = worldTransform;
        const cssScaleX = rect.width / 320;
        const cssScaleY = rect.height / 240;

        for (const child of overlay.children) {
          const el = child as HTMLElement;
          const id = el.dataset.agentId;
          if (!id) continue;
          const pos = spritePositions.get(id);
          if (pos) {
            const yOffset = Number(el.dataset.offsetY ?? -20);
            // Convert world coords → screen coords via stage transform
            const screenX = (pos.x - wt.pivotX) * wt.scaleX + wt.posX;
            const screenY = ((pos.y + yOffset) - wt.pivotY) * wt.scaleY + wt.posY;
            // Convert PixiJS screen coords → CSS coords
            el.style.left = `${offsetX + screenX * cssScaleX}px`;
            el.style.top = `${offsetY + screenY * cssScaleY}px`;
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
      {/* eslint-disable react-hooks/refs -- refs used intentionally for per-frame flash state */}
      {agentList.map((agent) => {
        let text: string | null = null;
        if (agent.waitingForHuman) {
          text = 'Waiting for you';
        } else if (agent.activityText) {
          text = agent.activityText.length > 25
            ? agent.activityText.slice(0, 24) + '\u2026'
            : agent.activityText;
        }

        // --- Waiting-on-team bubble override ---
        const activeChildCount = getActiveChildCount(agent, agents);
        const isSupervisorWaiting = activeChildCount > 0 && TEAM_PASSIVE_STATES.has(agent.state);
        const resultFlash = resultFlashesRef.current.get(agent.id);
        const hasResultFlash = resultFlash && resultFlash.expiresAt > now;

        if (hasResultFlash) {
          text = `Result from ${resultFlash.childName}!`;
        } else if (isSupervisorWaiting && !agent.waitingForHuman) {
          text = activeChildCount === 1
            ? 'Waiting on 1 agent'
            : `Waiting on ${activeChildCount} agents`;
        }

        const elapsed = now - agent.stateChangedAt;
        const showTimer = elapsed >= 10_000 && agent.state !== 'entering' && agent.state !== 'leaving';
        const teamBubbleStyle = (isSupervisorWaiting || hasResultFlash) && !agent.waitingForHuman
          ? { background: '#ce93d8', color: '#fff' }
          : null;
        const style = teamBubbleStyle ?? getBubbleStyle(agent.state, agent.waitingForHuman);
        const nameLabel = agent.name || agent.id.slice(0, 6);

        return (
          <Fragment key={agent.id}>
            {(text || showTimer) ? (
              <div
                data-agent-id={agent.id}
                data-offset-y="7"
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
              data-offset-y="2"
              className="sprite-label"
            >
              {nameLabel}
            </div>
          </Fragment>
        );
      })}
      {/* Supervisor check-in bubbles */}
      {Array.from(supervisorCheckIns.entries()).map(([supervisorId, checkIn]) => {
        const childAgent = agents.get(checkIn.childId);
        const childText = childAgent?.activityText
          ? (childAgent.activityText.length > 20
            ? childAgent.activityText.slice(0, 19) + '\u2026'
            : childAgent.activityText)
          : (childAgent?.state ?? 'working');

        return (
          <Fragment key={`checkin-${supervisorId}`}>
            <div
              data-agent-id={supervisorId}
              data-offset-y="12"
              className="speech-bubble checkin-bubble"
              style={{ background: '#ffd54f', color: '#000', fontSize: '0.7em' }}
            >
              <div>{checkIn.message}</div>
              <div style={{ opacity: 0.7, marginTop: '1px' }}>{childText}</div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
