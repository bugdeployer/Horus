"use client";
import { useEffect, useState } from "react";

export default function ThemeControl() {
  const [theme, setTheme] = useState("dark");
  useEffect(
    () =>
      setTheme(
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      ),
    [],
  );
  function choose(value: string) {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem("horus.theme", value);
    } catch {
      /* Storage may be disabled; the current theme still works. */
    }
  }
  return (
    <label className="rt-theme-control">
      Theme
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </label>
  );
}
