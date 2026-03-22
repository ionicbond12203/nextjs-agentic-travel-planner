"use client";

import { useChat } from "ai/react";
import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

const SUGGESTIONS = [
  "我想去欧洲旅行 🌍",
  "推荐东南亚预算友好的旅行路线",
  "日本两周深度游攻略",
  "适合家庭的海岛度假推荐",
];

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { messages, input, handleInputChange, handleSubmit, isLoading, addToolResult } =
    useChat({
      api: "/api/chat",
    });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasStarted, setHasStarted] = useState(false);

  // Prevent hydration mismatch - only render after client mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Return loading skeleton during SSR to prevent hydration mismatch
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
            <div style={{ width: 40, height: 40, borderRadius: "12px", background: "#333" }} />
            <div style={{ width: 120, height: 20, background: "#333", borderRadius: 4 }} />
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
    // Create a synthetic event with the suggestion text
    const syntheticEvent = {
      target: { value: text },
    } as React.ChangeEvent<HTMLInputElement>;
    handleInputChange(syntheticEvent);
    // Need to submit after state update
    setTimeout(() => {
      const form = document.getElementById("chat-form") as HTMLFormElement;
      form?.requestSubmit();
    }, 50);
  };

  return (
    <div className="flex flex-col h-screen">
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
              color: "#fff",
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
                  color: "#fff",
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
                          <p style={{ lineHeight: 1.6 }}>
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
                            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "16px", color: "#fff" }}>
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
                                ✓ 已选择: <strong style={{color: '#fff'}}>
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
                            background: "linear-gradient(145deg, rgba(20,20,30,0.8), rgba(40,40,60,0.8))",
                            backdropFilter: "blur(20px)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "20px",
                            padding: "24px",
                            width: "100%",
                            maxWidth: "480px",
                            boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
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
                              <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", background: "rgba(255,255,255,0.1)", padding: "4px 8px", borderRadius: "12px" }}>
                                {flight.flightNumber}
                              </span>
                            </div>

                            {/* Center: Route & Time */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0" }}>
                              <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{flight.departure?.split(' ')[0]}</div>
                                <div style={{ fontSize: "0.85rem", color: "#aaa" }}>{flight.departure?.split(' ').slice(1).join(' ')}</div>
                              </div>
                              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", padding: "0 10px" }}>
                                <span style={{ fontSize: "0.75rem", color: "#888", marginBottom: "4px" }}>{flight.duration}</span>
                                <div style={{ width: "100%", height: "2px", background: "rgba(255,255,255,0.2)", position: "relative" }}>
                                  <div style={{ position: "absolute", right: "-4px", top: "-4px", width: "10px", height: "10px", borderRadius: "50%", background: "#6366f1" }} />
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{flight.arrival?.split(' ')[0]}</div>
                                <div style={{ fontSize: "0.85rem", color: "#aaa" }}>{flight.arrival?.split(' ').slice(1).join(' ')}</div>
                              </div>
                            </div>

                            {/* Footer: Price & Action */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed rgba(255,255,255,0.2)" }}>
                              <div>
                                <span style={{ fontSize: "0.8rem", color: "#aaa" }}>预估总价</span>
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
                            background: "linear-gradient(145deg, rgba(20,60,40,0.8), rgba(30,80,50,0.8))",
                            backdropFilter: "blur(20px)",
                            border: "1px solid rgba(34,197,94,0.3)",
                            borderRadius: "20px",
                            padding: "24px",
                            width: "100%",
                            maxWidth: "480px",
                            boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
                            alignSelf: "flex-start",
                            color: "#fff",
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
                              <div style={{ background: "rgba(34,197,94,0.1)", borderRadius: "8px", padding: "12px", fontSize: "0.85rem", color: "#a7f3d0" }}>
                                💡 {transport.tips}
                              </div>
                            )}

                            {/* Price & Action */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed rgba(34,197,94,0.3)" }}>
                              <div>
                                <span style={{ fontSize: "0.8rem", color: "#aaa" }}>预估费用</span>
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
                  ? "#333"
                  : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none",
              borderRadius: "12px",
              padding: "14px 24px",
              color: isLoading || !input.trim() ? "#666" : "#fff",
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
  );
}
