"use client";

import * as React from "react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div style={{ width: 36, height: 36 }} />;
  }

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      style={{
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        width: 36,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "var(--color-text)",
        fontSize: "1.2rem",
        marginLeft: "12px",
      }}
      title="Toggle Theme"
    >
      {resolvedTheme === "dark" ? "🌞" : "🌙"}
    </button>
  );
}
