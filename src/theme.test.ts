import { describe, it, expect } from "vitest";
import { THEMES, TOKEN_NAMES, getTheme, v, defs, DEFAULT_THEME } from "./theme.ts";

describe("themes", () => {
  it("every built-in theme defines every token", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const token of TOKEN_NAMES) {
        expect(theme.tokens[token], `${name}.${token}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("getTheme resolves by name and defaults", () => {
    expect(getTheme("light").name).toBe("light");
    expect(getTheme().name).toBe(DEFAULT_THEME);
  });

  it("getTheme throws on an unknown name", () => {
    expect(() => getTheme("neon")).toThrow(/unknown theme/);
  });
});

describe("v (themed color reference)", () => {
  it("bakes the theme value as the var fallback", () => {
    const dark = getTheme("dark");
    expect(v(dark, "edge")).toBe(`var(--pin-edge, ${dark.tokens.edge})`);
  });
});

describe("defs", () => {
  it("emits a :root block with every token for live theming", () => {
    const dark = getTheme("dark");
    const out = defs(dark);
    expect(out).toContain(":root{");
    for (const token of TOKEN_NAMES) {
      expect(out).toContain(`--pin-${token}:${dark.tokens[token]}`);
    }
    // bg gradient + dot pattern reference the tokens (baked fallback present)
    expect(out).toContain(`stop-color="var(--pin-bg0, ${dark.tokens.bg0})"`);
    expect(out).toContain("id=\"pin-dots\"");
  });
});
