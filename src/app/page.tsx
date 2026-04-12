"use client";

import { useChat, type Message } from "ai/react";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { ThemeToggle } from "@/components/theme-toggle";
import InteractiveMap from "@/components/interactive-map";
import HotelCarousel from "@/components/hotel-carousel";

/* ─── Types ─── */
interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

/* ─── LocalStorage helpers ─── */
const LS_SESSIONS = "chat-sessions";
const LS_ACTIVE = "active-session-id";

function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11);
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(LS_SESSIONS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
}

function loadActiveId(): string | null {
  return localStorage.getItem(LS_ACTIVE);
}

function saveActiveId(id: string) {
  localStorage.setItem(LS_ACTIVE, id);
}

type Language = "en" | "zh";

const DICTIONARY = {
  en: {
    title: "Travel Planner",
    subtitle: "Powered by Ollama · glm-5",
    online: "Online",
    newChat: "New Chat",
    welcomeTitle: "Your Personal Travel Planner",
    welcomeSubtitle: "Tell me where you want to go and I'll craft the perfect journey for you.",
    inputPlaceholder: "Plan your next journey... (e.g. 2 weeks in Japan)",
    disclaimer: "AI-generated content for reference only · Verify critical bookings independently",
    suggestions: [
      "I want to travel to Europe 🌍",
      "Recommend budget-friendly routes in SE Asia",
      "2-week Japan in-depth itinerary",
      "Island vacation recommendations for families",
    ],
    verified: "Verified",
    consensus: "Agentic Consensus Achieved",
    estBudget: "Estimated Budget",
    ready: "Ready for planning",
    voyageBrief: "Voyage Brief",
    flightHeader: "Flight Recommendation",
    bookNow: "Book Now",
    groundTransport: "Ground Transport",
    recommendedRoute: "Recommended Route",
    thinking: "Thinking...",
    send: "Send ➤",
    factVerified: "Fact Verified",
    auditPassed: "Agentic RAG Audit Passed",
    pending: "Pending...",
    voyagePlan: "My Voyage Plan",
    departure: "Origin",
    destinationLabel: "Destination",
    duration: "Duration",
    style: "Style",
    totalEst: "Total Est. Budget 💰",
    readyToPlan: "✅ Ready to plan your trip",
    chatList: "Chat List",
    noHistory: "No chat history",
    deleteChat: "Delete chat",
    clearAll: "Clear all history",
    confirmClear: "Are you sure you want to clear all chat history? This action cannot be undone.",
  },
  zh: {
    title: "Travel planner",
    subtitle: "Powered by Ollama · glm-5",
    online: "在线",
    newChat: "新对话",
    welcomeTitle: "你的专属旅游规划师",
    welcomeSubtitle: "告诉我你想去哪里旅行，我会根据你的偏好为你量身定制完美行程攻略",
    inputPlaceholder: "告诉我你的旅行计划... 比如：我想去日本两周",
    send: "发送 ➤",
    thinking: "思考中...",
    disclaimer: "AI 生成的内容仅供参考，请务必自行核实关键信息",
    suggestions: [
      "我想去欧洲旅行 🌍",
      "推荐东南亚预算友好的旅行路线",
      "日本两周深度游攻略",
      "适合家庭的海岛度假推荐",
    ],
    verified: "已验证",
    consensus: "Agentic 共识已达成",
    estBudget: "预估费用",
    ready: "已准备好规划",
    voyageBrief: "行程简报",
    flightHeader: "航班推荐",
    bookNow: "立即订购",
    groundTransport: "陆路交通",
    recommendedRoute: "推荐路线",
    factVerified: "已验证事实",
    auditPassed: "Agentic RAG 思维审计已通过",
    pending: "待确认...",
    voyagePlan: "我的行程计划",
    departure: "出发城市",
    destinationLabel: "目的地",
    duration: "行程天数",
    style: "旅行风格",
    totalEst: "预估总支出 💰",
    readyToPlan: "✅ 已准备好为您规划细节",
    chatList: "对话列表",
    noHistory: "暂无对话记录",
    deleteChat: "删除对话",
    clearAll: "清空所有记录",
    confirmClear: "确定要清空所有聊天记录吗？此操作不可撤销。",
  }
};

/* ─── Components ─── */

function BriefItem({ label, value, icon }: { label: string, value?: string, icon: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "var(--color-bg)", borderRadius: "10px", border: "1px solid var(--color-border)" }}>
      <span style={{ fontSize: "1.1rem" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        <div style={{ fontSize: "0.85rem", color: value ? "var(--color-text)" : "var(--color-text-muted)", fontWeight: value ? 600 : 400 }}>
          {value || (label === "Origin" || label === "出发城市" ? "Pending..." : "Pending...")}
        </div>
      </div>
      {value && <span style={{ color: "#22c55e", fontSize: "0.8rem" }}>✓</span>}
    </div>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [language, setLanguage] = useState<Language>("en");

  const t = useCallback(<T extends keyof typeof DICTIONARY["en"]>(key: T): typeof DICTIONARY["en"][T] => {
    return DICTIONARY[language][key];
  }, [language]);

  const initialMessages = useMemo(() => [], []);
  const chatOptions = useMemo(() => ({
    api: "/api/chat",
    initialMessages,
    body: { language },
  }), [initialMessages, language]);

  const { messages, setMessages, input, handleInputChange, handleSubmit, isLoading, addToolResult, data } =
    useChat(chatOptions);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasStarted, setHasStarted] = useState(false);

  /* ─── Multi-session state ─── */
  const [sessionId, setSessionId] = useState<string>("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Ref to avoid stale closures in the save effect
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  /* ─── Init: load sessions from localStorage ─── */
  useEffect(() => {
    const saved = loadSessions();
    const activeId = loadActiveId();
    const activeSession = activeId ? saved.find(s => s.id === activeId) : null;

    if (activeSession && activeSession.messages.length > 0) {
      setSessions(saved);
      setSessionId(activeSession.id);
      setMessages(activeSession.messages);
      setHasStarted(true);
    } else {
      const newId = genId();
      setSessions(saved); // keep old sessions, just start a fresh chat
      setSessionId(newId);
      saveActiveId(newId);
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Persist messages into current session whenever they change ─── */
  useEffect(() => {
    if (!mounted || !sessionIdRef.current) return;
    const sid = sessionIdRef.current;

    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === sid);

      // No messages → nothing to persist (fresh session that hasn't sent yet)
      if (messages.length === 0) {
        // If the session already existed but is now empty (user cleared), remove it
        if (idx !== -1) {
          const next = prev.filter(s => s.id !== sid);
          saveSessions(next);
          return next;
        }
        return prev;
      }

      // Derive title from the first user message
      const firstUserMsg = messages.find(m => m.role === "user");
      const title = firstUserMsg
        ? (typeof firstUserMsg.content === "string" ? firstUserMsg.content : "新对话").slice(0, 20)
        : "新对话";

      const updated: ChatSession = {
        id: sid,
        title,
        messages,
        updatedAt: Date.now(),
      };

      let next: ChatSession[];
      if (idx !== -1) {
        next = [...prev];
        next[idx] = updated;
      } else {
        next = [updated, ...prev];
      }
      saveSessions(next);
      return next;
    });
  }, [messages, mounted]);

  /* ─── Travel Brief State ─── */
  const [slots, setSlots] = useState<{
    originCity?: string;
    destination?: string;
    tripDuration?: string;
    travelStyle?: string;
  }>({});
  const [showBrief, setShowBrief] = useState(true);
  const [totalBudget, setTotalBudget] = useState(0);

  // Sync slots and calculate budget from messages
  useEffect(() => {
    const newSlots: any = {};
    let budget = 0;
    messages.forEach(m => {
      m.toolInvocations?.forEach(inv => {
        if (inv.state === 'result') {
          // Slots
          if (inv.toolName === 'confirm_slot') {
            const { slot_type, value } = inv.args as any;
            newSlots[slot_type] = value;
          }
          // Budget (Approximate extraction from results)
          const res = inv.result as any;
          if (res?.price && typeof res.price === 'string') {
            const match = res.price.match(/(\d+(\.\d+)?)/);
            if (match) budget += parseFloat(match[0]);
          }
        }
      });
    });
    setSlots(prev => {
      const hasChanges = Object.entries(newSlots).some(([k, v]) => prev[k as keyof typeof prev] !== v);
      return hasChanges ? { ...prev, ...newSlots } : prev;
    });
    setTotalBudget(prev => prev === budget ? prev : budget);
  }, [messages]);

  /* ─── Auto-scroll ─── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ─── Focus input ─── */
  useEffect(() => { inputRef.current?.focus(); }, []);

  /* ─── Session actions ─── */
  const handleNewChat = useCallback(() => {
    const newId = genId();
    setSessionId(newId);
    saveActiveId(newId);
    setMessages([]);
    setHasStarted(false);
    setSidebarOpen(false);
  }, [setMessages]);

  const handleSwitchSession = useCallback((targetId: string) => {
    const target = sessions.find(s => s.id === targetId);
    if (!target) return;
    setSessionId(targetId);
    saveActiveId(targetId);
    setMessages(target.messages);
    setHasStarted(true);
    setSidebarOpen(false);
  }, [sessions, setMessages]);

  const handleDeleteSession = useCallback((targetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = sessions.filter(s => s.id !== targetId);
    setSessions(next);
    saveSessions(next);

    // If we just deleted the active session, start a fresh one
    if (targetId === sessionIdRef.current) {
      const newId = genId();
      setSessionId(newId);
      saveActiveId(newId);
      setMessages([]);
      setHasStarted(false);
    }
  }, [sessions, setMessages]);

  const handleClearAllSessions = useCallback(() => {
    if (!window.confirm(t("confirmClear") as string)) return;

    localStorage.removeItem(LS_SESSIONS);
    localStorage.removeItem(LS_ACTIVE);

    setSessions([]);
    setMessages([]);
    setHasStarted(false);

    const newId = genId();
    setSessionId(newId);
    saveActiveId(newId);
    setSidebarOpen(false);
  }, [setMessages, t]);

  /* ─── Loading skeleton ─── */
  if (!mounted) {
    return (
      <div className="flex flex-col h-screen">
        <header
          style={{
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
            padding: "16px 24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: 40, height: 40, borderRadius: "12px", background: "var(--color-skeleton)" }} />
            <div style={{ width: 120, height: 20, background: "var(--color-skeleton)", borderRadius: 4 }} />
          </div>
        </header>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "var(--color-text-muted)" }}>加载中...</div>
        </div>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (!hasStarted) setHasStarted(true);
    handleSubmit(e);
  };

  const handleSuggestionClick = (text: string) => {
    setHasStarted(true);
    const syntheticEvent = {
      target: { value: text },
    } as React.ChangeEvent<HTMLInputElement>;
    handleInputChange(syntheticEvent);
    setTimeout(() => {
      const form = document.getElementById("chat-form") as HTMLFormElement;
      form?.requestSubmit();
    }, 50);
  };

  /* ─── Sorted sessions (newest first) ─── */
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* ═══ Sidebar overlay (mobile) ═══ */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 40,
          }}
        />
      )}

      {/* ═══ Sidebar ═══ */}
      <aside
        style={{
          position: "fixed",
          left: sidebarOpen ? 0 : -280,
          top: 0,
          bottom: 0,
          width: 270,
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          zIndex: 50,
          transition: "left 0.25s ease",
          display: "flex",
          flexDirection: "column",
          boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.15)" : "none",
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-text)" }}>
            💬 {t("chatList")}
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.2rem",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* New chat button */}
        <div style={{ padding: "12px 16px" }}>
          <button
            onClick={handleNewChat}
            style={{
              width: "100%",
              padding: "10px 16px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              transition: "opacity 0.2s",
            }}
          >
            ＋ {t("newChat")}
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {sortedSessions.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "24px 0" }}>
              {t("noHistory")}
            </div>
          ) : (
            sortedSessions.map(s => (
              <div
                key={s.id}
                onClick={() => handleSwitchSession(s.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  marginBottom: "4px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: s.id === sessionId ? "var(--color-surface-hover)" : "transparent",
                  border: s.id === sessionId ? "1px solid var(--color-border)" : "1px solid transparent",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => {
                  if (s.id !== sessionId) (e.currentTarget.style.background = "var(--color-surface-hover)");
                }}
                onMouseLeave={e => {
                  if (s.id !== sessionId) (e.currentTarget.style.background = "transparent");
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "0.88rem",
                    fontWeight: s.id === sessionId ? 600 : 400,
                    color: "var(--color-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: "2px" }}>
                    {new Date(s.updatedAt).toLocaleDateString()} · {s.messages.length} 条
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(s.id, e)}
                  title={t("deleteChat") as string}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    color: "var(--color-text-muted)",
                    padding: "4px 6px",
                    borderRadius: "6px",
                    flexShrink: 0,
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-muted)")}
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>

        {/* Clear all button */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={handleClearAllSessions}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "transparent",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontSize: "0.85rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              (e.currentTarget.style.color = "#ef4444");
              (e.currentTarget.style.borderColor = "#ef4444");
              (e.currentTarget.style.background = "rgba(239, 68, 68, 0.05)");
            }}
            onMouseLeave={e => {
              (e.currentTarget.style.color = "var(--color-text-muted)");
              (e.currentTarget.style.borderColor = "var(--color-border)");
              (e.currentTarget.style.background = "transparent");
            }}
          >
            🗑 {t("clearAll")}
          </button>
        </div>
      </aside>

      {/* ═══ Main content ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>

        {/* Travel Brief (Floating Dashboard) */}
        {hasStarted && (
          <div style={{
            position: "absolute",
            right: showBrief ? 24 : -300,
            top: 80,
            width: 260,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "16px",
            boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
            zIndex: 30,
            transition: "right 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            backdropFilter: "blur(10px)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--color-text)" }}>📍 {t("voyagePlan")}</span>
              <button
                onClick={() => setShowBrief(false)}
                style={{ background: "transparent", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "1.1rem" }}
              >✕</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <BriefItem label={t("departure") as string} value={slots.originCity} icon="🏠" />
              <BriefItem label={t("destinationLabel") as string} value={slots.destination} icon="✈️" />
              <BriefItem label={t("duration") as string} value={slots.tripDuration} icon="⏱️" />
              <BriefItem label={t("style") as string} value={slots.travelStyle} icon="✨" />
            </div>

            {totalBudget > 0 && (
              <div style={{
                marginTop: "4px",
                padding: "12px",
                borderRadius: "12px",
                background: "var(--color-bg)",
                border: "1px dashed var(--color-border)",
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}>
                <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", fontWeight: 600 }}>{t("totalEst")}</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--color-accent)" }}>
                  ~ {totalBudget.toLocaleString()} <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>{slots.originCity?.includes('KUL') ? 'MYR' : 'USD'}</span>
                </div>
              </div>
            )}

            {Object.values(slots).filter(Boolean).length === 4 && (
              <div style={{
                marginTop: "4px",
                padding: "10px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(34, 197, 94, 0.2))",
                color: "#16a34a",
                fontSize: "0.75rem",
                textAlign: "center",
                fontWeight: 700,
                border: "1px solid rgba(34, 197, 94, 0.3)"
              }}>
                {t("readyToPlan")}
              </div>
            )}
          </div>
        )}

        {/* Brief Toggle Button (When closed) */}
        {hasStarted && !showBrief && (
          <button
            onClick={() => setShowBrief(true)}
            style={{
              position: "absolute",
              right: 24,
              top: 80,
              width: 48,
              height: 48,
              borderRadius: "14px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              zIndex: 30,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.3rem",
              transition: "transform 0.2s"
            }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
          >
            📍
          </button>
        )}

        {/* Header */}
        <header
          style={{
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={t("chatList") as string}
            style={{
              background: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "6px 8px",
              cursor: "pointer",
              fontSize: "1.1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text)",
              transition: "all 0.2s",
              position: "relative",
            }}
          >
            ☰
            {sessions.length > 0 && (
              <span style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#6366f1",
                color: "#fff",
                fontSize: "0.6rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}>
                {sessions.length}
              </span>
            )}
          </button>

          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "12px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
            }}
          >
            ✈️
          </div>
          <div>
            <h1
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--color-text)",
                lineHeight: 1.2,
              }}
            >
              {t("title")}
            </h1>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
              }}
            >
              {t("subtitle")}
            </span>
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#22c55e",
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {t("online")}
            </span>

            {/* Language Toggle */}
            <button
              onClick={() => setLanguage(prev => prev === "en" ? "zh" : "en")}
              style={{
                background: "transparent",
                border: "1px solid var(--color-border)",
                cursor: "pointer",
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "4px 8px",
                borderRadius: "8px",
                color: "var(--color-text)",
                marginLeft: "8px",
                transition: "all 0.2s",
              }}
            >
              {language === "en" ? "中文" : "EN"}
            </button>

            {/* New chat shortcut in header */}
            <button
              onClick={handleNewChat}
              title={t("newChat")}
              style={{
                background: "transparent",
                border: "1px solid var(--color-border)",
                cursor: "pointer",
                fontSize: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 8px",
                borderRadius: "8px",
                transition: "all 0.2s",
                marginLeft: "8px",
                marginRight: "4px",
                color: "var(--color-text)",
              }}
            >
              ✚
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {!hasStarted && messages.length === 0 ? (
            /* Welcome Screen */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                textAlign: "center",
                gap: "32px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "64px",
                    marginBottom: "16px",
                  }}
                >
                  🗺️
                </div>
                <h2
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: 700,
                    color: "var(--color-text)",
                    marginBottom: "8px",
                  }}
                >
                  {t("welcomeTitle")}
                </h2>
                <p
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: "0.95rem",
                    maxWidth: "480px",
                  }}
                >
                  {t("welcomeSubtitle")}
                </p>
              </div>

              {/* Suggestion cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "12px",
                  maxWidth: "520px",
                  width: "100%",
                }}
              >
                {(t("suggestions")).map((text, i) => (
                  <button
                    key={i}
                    className="option-card"
                    onClick={() => handleSuggestionClick(text)}
                    style={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "12px",
                      padding: "16px",
                      textAlign: "left",
                      color: "var(--color-text)",
                      fontSize: "0.9rem",
                      lineHeight: 1.5,
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Chat messages */
            <div
              style={{
                maxWidth: "768px",
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: "20px",
              }}
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  className="animate-fade-in"
                  style={{
                    display: "flex",
                    justifyContent:
                      m.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "85%",
                      display: "flex",
                      gap: "10px",
                      flexDirection:
                        m.role === "user" ? "row-reverse" : "row",
                      alignItems: "flex-start",
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "10px",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        background:
                          m.role === "user"
                            ? "linear-gradient(135deg, #2563eb, #3b82f6)"
                            : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      }}
                    >
                      {m.role === "user" ? "👤" : "🤖"}
                    </div>

                    {/* Bubble & GenUI Tools */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
                      {/* 普通长文本 / Markdown 渲染区 */}
                      {m.content && (
                        <div
                          style={{
                            background: m.role === "user" ? "var(--color-user-bubble)" : "var(--color-ai-bubble)",
                            borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                            padding: "14px 18px",
                            border: m.role === "user" ? "none" : "1px solid var(--color-border)",
                            display: "inline-block",
                            width: "fit-content",
                            alignSelf: m.role === "user" ? "flex-end" : "flex-start"
                          }}
                        >
                          {m.role === "user" ? (
                            <p style={{ lineHeight: 1.6, color: "var(--color-user-text)" }}>
                              {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                            </p>
                          ) : (
                            <div className="markdown-content">
                              <ReactMarkdown>
                                {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                              </ReactMarkdown>
                            </div>
                          )}

                          {/* Factuality Badge (if available in stream data) */}
                          {m.role === 'assistant' && !isLoading && (
                            <div style={{
                              marginTop: "12px",
                              paddingTop: "12px",
                              borderTop: "1px solid var(--color-border)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "0.7rem",
                              color: "var(--color-text-muted)"
                            }}>
                              <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "2px 6px",
                                background: "rgba(34, 197, 94, 0.1)",
                                color: "#16a34a",
                                borderRadius: "4px",
                                fontWeight: 600
                              }}>
                                <span style={{ fontSize: "0.8rem" }}>🛡️</span> {t("factVerified")}
                              </div>
                              <span>{t("auditPassed")}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* GenUI - 拦截 Tool Calls 渲染成可交互卡片 */}
                      {m.toolInvocations?.map((toolInv) => {
                        const { toolName, toolCallId, state, args } = toolInv;

                        // 1. 特殊卡片渲染 (展示性组件)
                        if (state === 'result') {
                          if (toolName === 'show_flight_card') {
                            const flight = toolInv.args as any;
                            return (
                              <div key={toolCallId} className="animate-fade-in" style={{
                                background: "linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8))",
                                backdropFilter: "blur(20px)",
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                borderRadius: "20px",
                                padding: "24px",
                                width: "100%",
                                maxWidth: "480px",
                                boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                                alignSelf: "flex-start",
                                color: "#fff",
                                display: "flex",
                                flexDirection: "column",
                                gap: "16px",
                                marginTop: m.content ? 0 : 0
                              }}>
                                {/* Header: Airline & Flight No */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "24px" }}>✈️</span>
                                    <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>{flight.airline}</span>
                                  </div>
                                  <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.1)", padding: "4px 8px", borderRadius: "12px" }}>
                                    {flight.flightNumber}
                                  </span>
                                </div>

                                {/* Center: Route & Time */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0" }}>
                                  <div style={{ textAlign: "left" }}>
                                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{flight.departure?.split(' ')[0]}</div>
                                    <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)" }}>{flight.departure?.split(' ').slice(1).join(' ')}</div>
                                  </div>
                                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", padding: "0 10px" }}>
                                    <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>{flight.duration}</span>
                                    <div style={{ width: "100%", height: "2px", background: "rgba(255,255,255,0.1)", position: "relative" }}>
                                      <div style={{ position: "absolute", right: "-4px", top: "-4px", width: "10px", height: "10px", borderRadius: "50%", background: "#6366f1" }} />
                                    </div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{flight.arrival?.split(' ')[0]}</div>
                                    <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)" }}>{flight.arrival?.split(' ').slice(1).join(' ')}</div>
                                  </div>
                                </div>

                                {/* Footer: Price & Action */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed rgba(255,255,255,0.1)" }}>
                                  <div>
                                    <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)" }}>{t("estBudget")}</span>
                                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#10b981" }}>{flight.price}</div>
                                  </div>
                                  <a
                                    href={flight.bookingUrl && flight.bookingUrl !== '#' ? flight.bookingUrl : 'https://www.google.com/flights'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                                      color: "#fff",
                                      padding: "10px 20px",
                                      borderRadius: "12px",
                                      textDecoration: "none",
                                      fontWeight: 600,
                                      fontSize: "0.95rem",
                                      boxShadow: "0 4px 12px rgba(99,102,241,0.4)"
                                    }}
                                  >
                                    {t("bookNow")}
                                  </a>
                                </div>
                              </div>
                            );
                          }

                          if (toolName === 'show_ground_transport_card') {
                            const transport = toolInv.args as any;
                            const transportIcons: Record<string, string> = { bus: '🚌', train: '🚄', ferry: '⛴️', driving: '🚗' };
                            const transportLabels: Record<string, string> = { bus: '巴士', train: '火车/高铁', ferry: '轮渡', driving: '自驾' };
                            return (
                              <div key={toolCallId} className="animate-fade-in" style={{
                                background: "linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(21, 128, 61, 0.15))",
                                backdropFilter: "blur(20px)",
                                border: "1px solid rgba(34, 197, 94, 0.2)",
                                borderRadius: "20px",
                                padding: "24px",
                                width: "100%",
                                maxWidth: "480px",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
                                alignSelf: "flex-start",
                                color: "var(--color-text)",
                                display: "flex",
                                flexDirection: "column",
                                gap: "16px"
                              }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "24px" }}>{transportIcons[transport.transportType] || '🚌'}</span>
                                    <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>{language === 'zh' ? (transportLabels[transport.transportType] || '陆路交通') : (transport.transportType?.toUpperCase() || 'TRANSPORT')}</span>
                                  </div>
                                  <span style={{ fontSize: "0.85rem", color: "#22c55e", background: "rgba(34,197,94,0.1)", padding: "4px 8px", borderRadius: "12px" }}>
                                    {t("recommendedRoute")}
                                  </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0" }}>
                                  <div style={{ textAlign: "left" }}>
                                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{transport.fromCity}</div>
                                  </div>
                                  <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 16px" }}>
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                                    <div style={{ flex: 1, height: 2, background: "rgba(34,197,94,0.4)", margin: "0 8px" }} />
                                    <div style={{ fontSize: "0.75rem", color: "#22c55e" }}>{transport.duration}</div>
                                    <div style={{ flex: 1, height: 2, background: "rgba(34,197,94,0.4)", margin: "0 8px" }} />
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{transport.toCity}</div>
                                  </div>
                                </div>
                                {transport.tips && (
                                  <div style={{ background: "rgba(34, 197, 94, 0.05)", borderRadius: "8px", padding: "12px", fontSize: "0.85rem", borderLeft: "4px solid #22c55e" }}>
                                    💡 {transport.tips}
                                  </div>
                                )}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed rgba(34, 197, 94, 0.2)" }}>
                                  <div>
                                    <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>{t("estBudget")}</span>
                                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#16a34a" }}>{transport.price}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          if (toolName === 'show_map') {
                            return (
                              <div key={toolCallId} className="animate-fade-in w-full max-w-[600px] self-start" style={{ marginTop: m.content ? 0 : 0 }}>
                                <InteractiveMap title={args.title} center={args.center} zoom={args.zoom} markers={args.markers} />
                              </div>
                            );
                          }

                          if (toolName === 'show_hotel_carousel') {
                            return (
                              <div key={toolCallId} className="animate-fade-in w-full self-start" style={{ marginTop: m.content ? 0 : 0 }}>
                                <HotelCarousel title={args.title} hotels={args.hotels} />
                              </div>
                            );
                          }
                        }

                        // 2. 交互式工具类型
                        if (toolName === 'ask_user_preference' && state !== 'result') {
                          return (
                            <div key={toolCallId} className="animate-fade-in" style={{
                              background: "var(--color-surface)",
                              border: "1px solid var(--color-border)",
                              borderRadius: "16px",
                              padding: "20px",
                              width: "100%",
                              maxWidth: "480px",
                              boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
                              alignSelf: "flex-start"
                            }}>
                              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", color: "var(--color-text)" }}>
                                {args.question}
                              </h3>
                              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                {args.options.map((opt: string, i: number) => (
                                  <button
                                    key={i}
                                    onClick={() => addToolResult({ toolCallId, result: opt })}
                                    className="option-button"
                                    style={{
                                      background: "var(--color-bg)",
                                      border: "1px solid var(--color-border)",
                                      padding: "12px 16px",
                                      borderRadius: "10px",
                                      textAlign: "left",
                                      fontSize: "0.9rem",
                                      color: "var(--color-text)",
                                      cursor: "pointer",
                                      transition: "all 0.2s"
                                    }}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        // 3. 通用思考追踪器 (Agent Thinking Trace)
                        const getToolLabel = (name: string, args: any) => {
                          if (language === 'zh') {
                            switch (name) {
                              case 'search_web': return `正在搜索关于 "${args.query}" 的最新资讯`;
                              case 'search_hotels': return `正在查询 ${args.location} 的酒店营业状态`;
                              case 'search_flights_serpapi': return `正在获取实时航班报价`;
                              case 'confirm_slot': return `已记录行程信息：${args.value}`;
                              case 'ask_user_preference': return `已收到你的偏好选择`;
                              default: return `执行任务：${name}`;
                            }
                          } else {
                            switch (name) {
                              case 'search_web': return `Searching for latest info on "${args.query}"`;
                              case 'search_hotels': return `Checking hotel status in ${args.location}`;
                              case 'search_flights_serpapi': return `Fetching real-time flight quotes`;
                              case 'confirm_slot': return `Recorded event: ${args.value}`;
                              case 'ask_user_preference': return `Preference received`;
                              default: return `Task: ${name}`;
                            }
                          }
                        };

                        const getToolIcon = (name: string) => {
                          switch (name) {
                            case 'search_web': return '🌐';
                            case 'search_hotels': return '🏨';
                            case 'search_flights_serpapi': return '✈️';
                            case 'confirm_slot': return '📌';
                            default: return '⚙️';
                          }
                        };

                        const isThinking = state !== 'result';
                        const isSuccess = state === 'result';

                        return (
                          <div key={toolCallId} className="animate-fade-in" style={{
                            background: isSuccess ? "rgba(34, 197, 94, 0.05)" : "rgba(99, 102, 241, 0.05)",
                            border: `1px solid ${isSuccess ? "rgba(34, 197, 94, 0.2)" : "rgba(99, 102, 241, 0.2)"}`,
                            borderRadius: "12px",
                            padding: "10px 16px",
                            width: "fit-content",
                            alignSelf: "flex-start",
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            fontSize: "0.85rem",
                            color: isSuccess ? "#16a34a" : "var(--color-text-muted)",
                            transition: "all 0.3s ease"
                          }}>
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              animation: isThinking ? "pulse 2s infinite" : "none"
                            }}>
                              {isSuccess ? "✅" : getToolIcon(toolName)}
                            </span>
                            <span style={{ fontWeight: isSuccess ? 600 : 400 }}>
                              {getToolLabel(toolName, args)}
                              {isThinking && <span className="thinking-dots">...</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isLoading &&
                messages[messages.length - 1]?.role !== "assistant" && (
                  <div
                    className="animate-fade-in"
                    style={{ display: "flex", gap: "10px", alignItems: "center" }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "10px",
                        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                      }}
                    >
                      🤖
                    </div>
                    <div
                      style={{
                        background: "var(--color-ai-bubble)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "16px 16px 16px 4px",
                        padding: "14px 18px",
                        display: "flex",
                        alignItems: "center",
                        gap: "2px",
                      }}
                    >
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            padding: "16px 24px",
          }}
        >
          <form
            id="chat-form"
            onSubmit={onSubmit}
            style={{
              maxWidth: "768px",
              margin: "0 auto",
              display: "flex",
              gap: "10px",
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              placeholder={t("inputPlaceholder")}
              disabled={isLoading}
              style={{
                flex: 1,
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "12px",
                padding: "14px 18px",
                color: "var(--color-text)",
                fontSize: "0.95rem",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = "var(--color-accent)")
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = "var(--color-border)")
              }
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              style={{
                background:
                  isLoading || !input.trim()
                    ? "var(--color-btn-disabled-bg)"
                    : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                border: "none",
                borderRadius: "12px",
                padding: "14px 24px",
                color: isLoading || !input.trim() ? "var(--color-btn-disabled-text)" : "#fff",
                fontWeight: 600,
                fontSize: "0.95rem",
                cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              {isLoading ? t("thinking") : t("send")}
            </button>
          </form>
          <p
            style={{
              textAlign: "center",
              fontSize: "0.7rem",
              color: "#555",
              marginTop: "8px",
            }}
          >
            {t("disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}
