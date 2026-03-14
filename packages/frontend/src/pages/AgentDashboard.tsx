import { useEffect, useRef, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { env } from '../config/env';
import type { RootState } from '../store';
import { postAgentChat } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentActivity {
  id: number;
  created_at: string;
  campaign_address: string | null;
  property_id: string | null;
  event_type: string;
  raised_usdc: number | null;
  target_usdc: number | null;
  campaign_state: string | null;
  reasoning: string;
  tx_hash: string | null;
  executed: boolean;
  user_message: string | null;
  severity: 'info' | 'success' | 'warning' | 'error';
}

interface AgentStatus {
  online: boolean;
  agentAddress?: string;
  operatorAddress?: string | null;
  hasDedicatedAgentKey?: boolean;
  network?: string;
  pollIntervalMs?: number;
  executionPolicy?: 'observe' | 'recommend' | 'execute';
  canExecuteTransactions?: boolean;
  capabilities?: {
    monitor: boolean;
    recommend: boolean;
    execute: boolean;
    propertyAwareChat: boolean;
  };
  executionGuards?: string[];
  lastSeen?: string;
  lastEvent?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = env.API_BASE_URL || 'http://localhost:3000';
const POLL_INTERVAL = 8000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { icon: string; label: string }> = {
  AGENT_STARTED:            { icon: '◎', label: 'Agent Started' },
  CAMPAIGN_FINALIZED_SUCCESS: { icon: '✦', label: 'Campaign Funded' },
  CAMPAIGN_FINALIZED_FAILED:  { icon: '◇', label: 'Campaign Failed' },
  EQUITY_TOKEN_SET:         { icon: '⬡', label: 'Equity Issued' },
  POOL_MONITORING:          { icon: '◌', label: 'Monitoring Pool' },
  CHAT_RESPONSE:            { icon: '◈', label: 'Chat' },
  AGENT_ERROR:              { icon: '△', label: 'Error' },
};

const SEVERITY_COLORS: Record<string, string> = {
  success: '#C9A84C',
  info:    '#6B9BC3',
  warning: '#D4884A',
  error:   '#C35A5A',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function progressPct(raised: number | null, target: number | null) {
  if (!raised || !target || target === 0) return 0;
  return Math.min(Math.round((raised / target) * 100), 100);
}

// ─── Components ───────────────────────────────────────────────────────────────

function PulseDot({ online }: { online: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 10, height: 10 }}>
      <span style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%',
        background: online ? '#C9A84C' : '#555',
        animation: online ? 'pulse 2s ease-in-out infinite' : 'none',
      }} />
      <span style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%',
        background: online ? '#C9A84C' : '#555',
        opacity: 0.4,
        animation: online ? 'ripple 2s ease-out infinite' : 'none',
      }} />
    </span>
  );
}

function ActivityCard({ activity, isNew }: { activity: AgentActivity; isNew: boolean }) {
  const meta = EVENT_META[activity.event_type] || { icon: '○', label: activity.event_type };
  const color = SEVERITY_COLORS[activity.severity] || '#888';
  const pct   = progressPct(activity.raised_usdc, activity.target_usdc);

  return (
    <div style={{
      padding: '18px 20px',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      gap: 16,
      animation: isNew ? 'slideIn 0.4s ease-out' : 'none',
      transition: 'background 0.2s',
      background: isNew ? 'rgba(201,168,76,0.04)' : 'transparent',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={e => (e.currentTarget.style.background = isNew ? 'rgba(201,168,76,0.04)' : 'transparent')}
    >
      {/* Icon */}
      <div style={{
        flex: '0 0 32px', height: 32,
        borderRadius: 4,
        border: `1px solid ${color}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color, background: `${color}10`,
        fontFamily: 'monospace',
      }}>
        {meta.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontFamily: '"Space Mono", monospace',
            color, letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            {meta.label}
          </span>

          {activity.campaign_address && (
            <span style={{
              fontSize: 10, color: '#555', fontFamily: 'monospace',
              background: 'rgba(255,255,255,0.04)', padding: '1px 6px', borderRadius: 2,
            }}>
              {shortAddr(activity.campaign_address)}
            </span>
          )}

          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#444', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            {formatDate(activity.created_at)} · {formatTime(activity.created_at)}
          </span>
        </div>

        {/* User message (for chat) */}
        {activity.user_message && (
          <p style={{
            margin: '0 0 6px', fontSize: 12, color: '#666',
            fontStyle: 'italic', fontFamily: '"Crimson Text", Georgia, serif',
          }}>
            "{activity.user_message}"
          </p>
        )}

        {/* Reasoning */}
        <p style={{
          margin: '0 0 8px', fontSize: 13, color: '#ccc', lineHeight: 1.55,
          fontFamily: '"Crimson Text", Georgia, serif',
        }}>
          {activity.reasoning}
        </p>

        {/* Progress bar */}
        {activity.raised_usdc != null && activity.target_usdc != null && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                ${activity.raised_usdc.toLocaleString()} raised
              </span>
              <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                {pct}% of ${activity.target_usdc.toLocaleString()}
              </span>
            </div>
            <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: color, borderRadius: 1,
                transition: 'width 0.8s ease',
              }} />
            </div>
          </div>
        )}

        {/* TX hash + execution badge */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {activity.tx_hash && (
            <a
              href={`https://sepolia.basescan.org/tx/${activity.tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10, color: '#C9A84C', fontFamily: 'monospace',
                textDecoration: 'none', borderBottom: '1px solid rgba(201,168,76,0.3)',
              }}
            >
              {shortAddr(activity.tx_hash)} ↗
            </a>
          )}
          {activity.executed && (
            <span style={{
              fontSize: 9, color: '#5A8A5A', border: '1px solid rgba(90,138,90,0.3)',
              padding: '1px 5px', borderRadius: 2, fontFamily: 'monospace',
              letterSpacing: '0.06em',
            }}>
              EXECUTED
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  onClose,
  onSend,
  messages,
  loading,
  requiresSignIn,
}: {
  onClose: () => void;
  onSend: (msg: string) => void;
  messages: { role: 'user' | 'agent'; text: string }[];
  loading: boolean;
  requiresSignIn: boolean;
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleSubmit() {
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput('');
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      width: 360, maxHeight: 520,
      background: '#0E0E0E', border: '1px solid rgba(201,168,76,0.2)',
      borderRadius: 8, boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
      display: 'flex', flexDirection: 'column',
      zIndex: 1000,
      animation: 'slideUp 0.3s ease-out',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#C9A84C', fontSize: 13, fontFamily: '"Space Mono", monospace' }}>
            ◈ BRICKT AGENT
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 200 }}>
        {messages.length === 0 && (
          <p style={{ color: '#444', fontSize: 12, fontFamily: '"Crimson Text", serif', fontStyle: 'italic' }}>
            {requiresSignIn
              ? 'Sign in from the header first, then ask about funding status, investor returns, or what the agent is doing on-chain.'
              : 'Ask me anything about the pools — funding status, investor returns, or what I\'m doing on-chain.'}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 10, color: m.role === 'user' ? '#666' : '#C9A84C',
              fontFamily: 'monospace', marginBottom: 3,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              {m.role === 'user' ? 'You' : 'Agent'}
            </div>
            <p style={{
              margin: 0, fontSize: 13, lineHeight: 1.5,
              color: m.role === 'user' ? '#999' : '#ddd',
              fontFamily: '"Crimson Text", Georgia, serif',
            }}>
              {m.text}
            </p>
          </div>
        ))}
        {loading && (
          <div style={{ color: '#555', fontSize: 12, fontFamily: 'monospace' }}>
            thinking<span style={{ animation: 'blink 1s step-end infinite' }}>...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: 8,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder={requiresSignIn ? 'Sign in from the header to chat...' : 'Ask the agent...'}
          disabled={requiresSignIn}
          style={{
            flex: 1, background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4, padding: '7px 10px',
            color: '#ddd', fontSize: 12,
            fontFamily: '"Space Mono", monospace',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={requiresSignIn || loading || !input.trim()}
          style={{
            background: requiresSignIn || loading ? 'rgba(201,168,76,0.2)' : '#C9A84C',
            border: 'none', borderRadius: 4,
            padding: '0 14px', cursor: requiresSignIn || loading ? 'not-allowed' : 'pointer',
            color: '#0a0a0a', fontFamily: '"Space Mono", monospace',
            fontSize: 11, fontWeight: 700,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentDashboard() {
  const token = useSelector((state: RootState) => state.user.token);
  const walletAddress = useSelector((state: RootState) => state.user.address);
  const [activities, setActivities]     = useState<AgentActivity[]>([]);
  const [status, setStatus]             = useState<AgentStatus>({ online: false });
  const [newIds, setNewIds]             = useState<Set<number>>(new Set());
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'agent'; text: string }[]>([]);
  const [chatLoading, setChatLoading]   = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const seenIds = useRef<Set<number>>(new Set());

  const fetchActivities = useCallback(async () => {
    try {
      const params = filterSeverity !== 'all' ? `&severity=${filterSeverity}` : '';
      const res = await fetch(`${API_BASE}/v1/agent/activities?limit=40${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const incoming: AgentActivity[] = data.activities || [];

      // Mark genuinely new items
      const fresh = incoming.filter(a => !seenIds.current.has(a.id));
      if (fresh.length > 0) {
        const freshSet = new Set(fresh.map(a => a.id));
        setNewIds(prev => new Set([...prev, ...freshSet]));
        setTimeout(() => setNewIds(prev => {
          const next = new Set(prev);
          freshSet.forEach(id => next.delete(id));
          return next;
        }), 3000);
        fresh.forEach(a => seenIds.current.add(a.id));
      }

      setActivities(incoming);
    } catch {}
  }, [filterSeverity]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/agent/status`);
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchActivities();
    fetchStatus();
    const t1 = setInterval(fetchActivities, POLL_INTERVAL);
    const t2 = setInterval(fetchStatus, 15000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchActivities, fetchStatus]);

  async function sendChat(message: string) {
    if (!token) {
      setChatMessages(prev => [...prev, { role: 'agent', text: 'Sign in to chat with the agent.' }]);
      return;
    }

    setChatMessages(prev => [...prev, { role: 'user', text: message }]);
    setChatLoading(true);
    try {
      const data = await postAgentChat(token, { message });
      setChatMessages(prev => [...prev, { role: 'agent', text: data.response || data.error || 'No response.' }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'agent', text: 'Could not reach the agent. Is it running?' }]);
    } finally {
      setChatLoading(false);
    }
  }

  const filtered = activities.filter(a =>
    filterSeverity === 'all' || a.severity === filterSeverity
  );

  const stats = {
    total:    activities.length,
    success:  activities.filter(a => a.severity === 'success').length,
    executed: activities.filter(a => a.executed).length,
    errors:   activities.filter(a => a.severity === 'error').length,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital@0;1&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(0.9); }
        }
        @keyframes ripple {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes scan {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 0.03; }
          90%  { opacity: 0.03; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(201,168,76,0.2); border-radius: 2px; }
      `}</style>

      <div style={{
        minHeight: '100vh',
        background: '#080808',
        color: '#ccc',
        fontFamily: '"Space Mono", monospace',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Scan line effect */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(transparent 50%, rgba(0,0,0,0.02) 50%)',
          backgroundSize: '100% 3px',
          pointerEvents: 'none', zIndex: 0,
        }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto', padding: '0 20px' }}>

          {/* Header */}
          <div style={{
            padding: '32px 0 24px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <PulseDot online={status.online} />
                  <span style={{ fontSize: 10, color: status.online ? '#C9A84C' : '#555', letterSpacing: '0.12em' }}>
                    {status.online ? 'AGENT ONLINE' : 'AGENT OFFLINE'}
                  </span>
                  {status.network && (
                    <span style={{ fontSize: 9, color: '#444', letterSpacing: '0.08em' }}>
                      · {status.network.toUpperCase()}
                    </span>
                  )}
                </div>
                <h1 style={{
                  margin: 0, fontSize: 22,
                  fontFamily: '"Crimson Text", Georgia, serif',
                  fontWeight: 600, color: '#f0f0f0', letterSpacing: '0.01em',
                }}>
                  Brickt Investment Agent
                </h1>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#444', letterSpacing: '0.04em' }}>
                  Autonomous on-chain real estate fund manager · Base
                </p>
                {status.agentAddress && (
                  <p style={{ margin: '6px 0 0', fontSize: 10, color: '#3A3A3A', fontFamily: 'monospace' }}>
                    {status.agentAddress}
                  </p>
                )}
                {status.hasDedicatedAgentKey !== undefined && (
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                    {status.hasDedicatedAgentKey ? 'Dedicated agent wallet active' : 'Using operator wallet as agent fallback'}
                  </p>
                )}
                {status.operatorAddress ? (
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#2f2f2f', fontFamily: 'monospace' }}>
                    operator {status.operatorAddress}
                  </p>
                ) : null}
                {status.executionPolicy ? (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 10,
                        color: '#C9A84C',
                        border: '1px solid rgba(201,168,76,0.24)',
                        background: 'rgba(201,168,76,0.08)',
                        padding: '3px 8px',
                        borderRadius: 999,
                        letterSpacing: '0.08em',
                      }}
                    >
                      POLICY · {status.executionPolicy.toUpperCase()}
                    </span>
                    {status.capabilities?.monitor ? (
                      <span style={{ fontSize: 10, color: '#666', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: 999 }}>
                        MONITOR
                      </span>
                    ) : null}
                    {status.capabilities?.recommend ? (
                      <span style={{ fontSize: 10, color: '#6B9BC3', border: '1px solid rgba(107,155,195,0.24)', padding: '3px 8px', borderRadius: 999 }}>
                        RECOMMEND
                      </span>
                    ) : null}
                    {status.capabilities?.execute ? (
                      <span style={{ fontSize: 10, color: '#5A8A5A', border: '1px solid rgba(90,138,90,0.24)', padding: '3px 8px', borderRadius: 999 }}>
                        EXECUTE
                      </span>
                    ) : null}
                    {status.capabilities?.propertyAwareChat ? (
                      <span style={{ fontSize: 10, color: '#888', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: 999 }}>
                        PROPERTY CHAT
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {status.executionGuards && status.executionGuards.length > 0 ? (
                  <div style={{ marginTop: 10, maxWidth: 560 }}>
                    <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', marginBottom: 6 }}>
                      EXECUTION GUARDS
                    </div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {status.executionGuards.map((guard) => (
                        <div key={guard} style={{ fontSize: 11, color: '#666', lineHeight: 1.5 }}>
                          • {guard}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 20 }}>
                {[
                  { label: 'EVENTS', value: stats.total },
                  { label: 'SUCCESS', value: stats.success, color: '#C9A84C' },
                  { label: 'ON-CHAIN', value: stats.executed, color: '#6B9BC3' },
                  { label: 'ERRORS', value: stats.errors, color: stats.errors > 0 ? '#C35A5A' : undefined },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, color: s.color || '#666', fontFamily: '"Crimson Text", serif', fontWeight: 600 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 8, color: '#3A3A3A', letterSpacing: '0.1em' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {!token && (
            <div
              style={{
                marginBottom: 20,
                padding: '12px 14px',
                border: '1px solid rgba(201,168,76,0.22)',
                borderRadius: 6,
                background: 'rgba(201,168,76,0.06)',
                color: '#d8c58a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', marginBottom: 4 }}>CHAT ACCESS REQUIRES APP SIGN-IN</div>
                <div style={{ fontSize: 12, color: '#9b9372', fontFamily: '"Crimson Text", Georgia, serif' }}>
                  {walletAddress
                    ? 'Your wallet is connected, but the agent chat only unlocks after you complete app sign-in from the header.'
                    : 'Connect your wallet and complete app sign-in from the header before chatting with the agent.'}
                </div>
              </div>
            </div>
          )}

          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {['all', 'success', 'info', 'warning', 'error'].map(f => (
              <button
                key={f}
                onClick={() => setFilterSeverity(f)}
                style={{
                  background: filterSeverity === f ? 'rgba(201,168,76,0.12)' : 'transparent',
                  border: `1px solid ${filterSeverity === f ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 3, padding: '4px 10px',
                  color: filterSeverity === f ? '#C9A84C' : '#444',
                  cursor: 'pointer', fontSize: 9,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  fontFamily: '"Space Mono", monospace',
                  transition: 'all 0.15s',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Activity feed */}
          <div style={{
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 6,
            overflow: 'hidden',
            marginBottom: 100,
          }}>
            {/* Feed header */}
            <div style={{
              padding: '10px 20px',
              background: 'rgba(255,255,255,0.02)',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 9, color: '#444', letterSpacing: '0.1em' }}>
                ACTIVITY LOG · LIVE · REFRESHES EVERY {POLL_INTERVAL / 1000}S
              </span>
              <span style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>
                {filtered.length} event{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <p style={{ color: '#333', fontSize: 12, fontFamily: '"Crimson Text", serif', fontStyle: 'italic' }}>
                  {status.online
                    ? 'No activity yet. The agent is monitoring pools...'
                    : 'Agent is offline. Start it with: pnpm --filter @homeshare/backend agent:run'}
                </p>
              </div>
            ) : (
              filtered.map(activity => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  isNew={newIds.has(activity.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Chat toggle button */}
        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            style={{
              position: 'fixed', bottom: 24, right: 24,
              background: '#C9A84C', border: 'none', borderRadius: 6,
              padding: '12px 20px', cursor: 'pointer',
              color: '#0a0a0a', fontFamily: '"Space Mono", monospace',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              boxShadow: '0 8px 32px rgba(201,168,76,0.3)',
              transition: 'transform 0.15s, box-shadow 0.15s',
              zIndex: 999,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 12px 40px rgba(201,168,76,0.4)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 32px rgba(201,168,76,0.3)';
            }}
          >
            {token ? '◈ CHAT WITH AGENT' : '◈ SIGN IN TO CHAT'}
          </button>
        )}

        {/* Chat panel */}
        {chatOpen && (
          <ChatPanel
            onClose={() => setChatOpen(false)}
            onSend={sendChat}
            messages={chatMessages}
            loading={chatLoading}
            requiresSignIn={!token}
          />
        )}
      </div>
    </>
  );
}
