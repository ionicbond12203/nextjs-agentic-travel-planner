"use client";

import { useChat, type Message } from "ai/react";
import { useRef, useEffect, useState, useCallback } from "react";
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
  return crypto.randomUUID();
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

const SUGGESTIONS = [
  "我想去欧洲旅行 🌍",
  "推荐东南亚预算友好的旅行路线",
  "日本两周深度游攻略",
  "适合家庭的海岛度假推荐",
];

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { messages, setMessages, input, handleInputChange, handleSubmit, isLoading, addToolResult } =
    useChat({
      api: "/api/chat",
    });
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
            💬 对话列表
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
            ＋ 新对话
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {sortedSessions.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "24px 0" }}>
              暂无对话记录
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
                  title="删除对话"
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
      </aside>

      {/* ═══ Main content ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
            title="对话列表"
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
              旅游 AI 规划师
            </h1>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
              }}
            >
              Powered by Ollama · qwen3
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
              在线
            </span>
            {/* New chat shortcut in header */}
            <button
              onClick={handleNewChat}
              title="新对话"
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
                你的专属旅游规划师
              </h2>
              <p
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: "0.95rem",
                  maxWidth: "480px",
                }}
              >
                告诉我你想去哪里旅行，我会根据你的偏好为你量身定制完美行程攻略
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
              {SUGGESTIONS.map((text, i) => (
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
                      </div>
                    )}

                    {/* GenUI - 拦截 Tool Calls 渲染成可交互卡片 */}
                    {m.toolInvocations?.map((toolInv) => {
                      if (toolInv.toolName === 'search_web') {
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in" style={{
                            background: "rgba(99, 102, 241, 0.05)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "12px",
                            padding: "12px 16px",
                            width: "fit-content",
                            alignSelf: "flex-start",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            color: "var(--color-text-muted)",
                            fontSize: "0.85rem"
                          }}>
                            {toolInv.state === "result" ? "✅" : "🌐"}
                            <span>
                              {toolInv.state === "result" 
                                ? `已搜索：${toolInv.args.query}` 
                                : `正在查询最新资讯：${toolInv.args.query}...`}
                            </span>
                          </div>
                        );
                      }
                      if (toolInv.toolName === 'ask_user_preference') {
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in" style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "16px",
                            padding: "20px",
                            width: "100%",
                            maxWidth: "480px",
                            boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
                            alignSelf: "flex-start",
                            marginTop: m.content ? 0 : 0
                          }}>
                            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "16px", color: "var(--color-text)" }}>
                              {toolInv.args.question}
                            </h3>
                            {toolInv.state === "result" ? (
                              <div style={{
                                background: "rgba(99, 102, 241, 0.1)",
                                border: "1px solid var(--color-accent)",
                                color: "var(--color-text)",
                                padding: "12px 16px",
                                borderRadius: "8px",
                                fontSize: "0.95rem"
                              }}>
                                ✓ 已选择: <strong style={{color: 'var(--color-text)'}}>
                                  {typeof toolInv.result === 'string' ? toolInv.result : '已从服务器获取信息'}
                                </strong>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                {toolInv.args.options.map((opt: string, i: number) => (
                                  <button
                                    key={i}
                                    onClick={() => addToolResult({ toolCallId: toolInv.toolCallId, result: opt })}
                                    className="option-card"
                                    style={{
                                      background: "var(--color-bg)",
                                      border: "1px solid var(--color-border)",
                                      padding: "14px 16px",
                                      borderRadius: "8px",
                                      textAlign: "left",
                                      fontSize: "0.95rem",
                                      color: "var(--color-text)",
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      cursor: "pointer"
                                    }}
                                  >
                                    <span>{opt}</span>
                                    <span style={{ color: "var(--color-text-muted)" }}>→</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (toolInv.toolName === 'show_flight_card') {
                        const flight = toolInv.args as any;
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in" style={{
                            background: "var(--color-card-flight-bg)",
                            backdropFilter: "blur(20px)",
                            border: "1px solid var(--color-card-border)",
                            borderRadius: "20px",
                            padding: "24px",
                            width: "100%",
                            maxWidth: "480px",
                            boxShadow: "var(--color-card-shadow)",
                            alignSelf: "flex-start",
                            color: "var(--color-text)",
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
                              <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", background: "var(--color-card-label-bg)", padding: "4px 8px", borderRadius: "12px" }}>
                                {flight.flightNumber}
                              </span>
                            </div>

                            {/* Center: Route & Time */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0" }}>
                              <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{flight.departure?.split(' ')[0]}</div>
                                <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>{flight.departure?.split(' ').slice(1).join(' ')}</div>
                              </div>
                              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", padding: "0 10px" }}>
                                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "4px" }}>{flight.duration}</span>
                                <div style={{ width: "100%", height: "2px", background: "var(--color-card-divider)", position: "relative" }}>
                                  <div style={{ position: "absolute", right: "-4px", top: "-4px", width: "10px", height: "10px", borderRadius: "50%", background: "var(--color-accent)" }} />
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{flight.arrival?.split(' ')[0]}</div>
                                <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>{flight.arrival?.split(' ').slice(1).join(' ')}</div>
                              </div>
                            </div>

                            {/* Footer: Price & Action */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed var(--color-card-divider)" }}>
                              <div>
                                <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>预估总价</span>
                                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#22c55e" }}>{flight.price}</div>
                              </div>
                              {toolInv.state === "result" && (
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
                                  立即查价
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (toolInv.toolName === 'show_ground_transport_card') {
                        const transport = toolInv.args as any;
                        const transportIcons: Record<string, string> = {
                          bus: '🚌',
                          train: '🚄',
                          ferry: '⛴️',
                          driving: '🚗'
                        };
                        const transportLabels: Record<string, string> = {
                          bus: '巴士',
                          train: '火车/高铁',
                          ferry: '轮渡',
                          driving: '自驾'
                        };
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in" style={{
                            background: "var(--color-card-transport-bg)",
                            backdropFilter: "blur(20px)",
                            border: "1px solid var(--color-card-transport-border)",
                            borderRadius: "20px",
                            padding: "24px",
                            width: "100%",
                            maxWidth: "480px",
                            boxShadow: "var(--color-card-shadow)",
                            alignSelf: "flex-start",
                            color: "var(--color-text)",
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px"
                          }}>
                            {/* Header */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "24px" }}>{transportIcons[transport.transportType] || '🚌'}</span>
                                <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>{transportLabels[transport.transportType] || '陆路交通'}</span>
                              </div>
                              <span style={{ fontSize: "0.85rem", color: "#22c55e", background: "rgba(34,197,94,0.2)", padding: "4px 8px", borderRadius: "12px" }}>
                                推荐路线
                              </span>
                            </div>

                            {/* Route */}
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

                            {/* Tips */}
                            {transport.tips && (
                              <div style={{ background: "var(--color-card-transport-tip-bg)", borderRadius: "8px", padding: "12px", fontSize: "0.85rem", color: "var(--color-card-transport-tip-text)" }}>
                                💡 {transport.tips}
                              </div>
                            )}

                            {/* Price & Action */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed var(--color-card-transport-border)" }}>
                              <div>
                                <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>预估费用</span>
                                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#22c55e" }}>{transport.price}</div>
                              </div>
                              {toolInv.state === "result" && transport.bookingUrl && transport.bookingUrl !== '#' && (
                                <a
                                  href={transport.bookingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    background: "linear-gradient(135deg, #22c55e, #16a34a)",
                                    color: "#fff",
                                    padding: "10px 20px",
                                    borderRadius: "12px",
                                    textDecoration: "none",
                                    fontWeight: 600,
                                    fontSize: "0.95rem",
                                    boxShadow: "0 4px 12px rgba(34,197,94,0.4)"
                                  }}
                                >
                                  查看详情
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (toolInv.toolName === 'confirm_slot') {
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in" style={{
                            background: "rgba(34, 197, 94, 0.05)",
                            border: "1px solid rgba(34, 197, 94, 0.2)",
                            borderRadius: "12px",
                            padding: "8px 16px",
                            width: "fit-content",
                            alignSelf: "flex-start",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            color: "#22c55e",
                            fontSize: "0.85rem"
                          }}>
                            <span>✅ 已确认：{(toolInv.args as any).value}</span>
                          </div>
                        );
                      }
                      if (toolInv.toolName === 'show_map') {
                        const mapData = toolInv.args as any;
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in w-full max-w-[600px] self-start" style={{ marginTop: m.content ? 0 : 0 }}>
                            <InteractiveMap 
                              title={mapData.title}
                              center={mapData.center}
                              zoom={mapData.zoom}
                              markers={mapData.markers}
                            />
                          </div>
                        );
                      }
                      if (toolInv.toolName === 'show_hotel_carousel') {
                        const hotelData = toolInv.args as any;
                        return (
                          <div key={toolInv.toolCallId} className="animate-fade-in w-full self-start" style={{ marginTop: m.content ? 0 : 0 }}>
                            <HotelCarousel 
                              title={hotelData.title}
                              hotels={hotelData.hotels}
                            />
                          </div>
                        );
                      }
                      return null;
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
            placeholder="告诉我你的旅行计划... 比如：我想去日本两周"
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
            {isLoading ? "思考中..." : "发送 ➤"}
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
          AI 生成的内容仅供参考，请务必自行核实关键信息
        </p>
      </div>
      </div>
    </div>
  );
}
