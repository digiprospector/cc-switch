import { describe, expect, it } from "vitest";
import {
  buildBatchAppPreviews,
  buildBatchProviderPreview,
  getSourceRecords,
  selectClaudeMapping,
  selectCodexModel,
} from "@/components/providers/batchAddProviders";

describe("batchAddProviders", () => {
  it("builds source records from src json files", () => {
    const records = getSourceRecords({
      "../../foo.json": {
        post_url: " https://post.example.com ",
        web_url: " https://site.example.com ",
        web_type: "custom",
        base_url: "https://api.example.com",
        api_key: "sk-test",
      },
      "../../skip.json": {
        base_url: "https://api.example.com",
        api_key: "",
      },
    });

    expect(records).toEqual([
      {
        fileName: "foo.json",
        providerName: "foo",
        postUrl: "https://post.example.com",
        webUrl: "https://site.example.com",
        webType: "custom",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
      },
    ]);
  });

  it("prefers codex models for codex and maps provider fields from source", () => {
    const preview = buildBatchProviderPreview(
      "codex",
      {
        fileName: "batch-source.json",
        providerName: "batch-source",
        postUrl: "https://post.example.com/1",
        webUrl: "https://site.example.com",
        webType: "custom",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
      },
      [
        { id: "gpt-5-codex" },
        { id: "gpt-5.1" },
        { id: "gpt-5.4" },
        { id: "claude-sonnet-4.5" },
      ],
    );

    expect(
      selectCodexModel([
        { id: "gpt-5.1" },
        { id: "gpt-5.4" },
        { id: "gpt-5-codex" },
      ])?.id,
    ).toBe("gpt-5-codex");
    expect(preview.selectedModel?.id).toBe("gpt-5-codex");
    expect(preview.providerInput).toMatchObject({
      name: "batch-source",
      notes: "https://post.example.com/1",
      websiteUrl: "https://site.example.com",
      category: "third_party",
      icon: "custom",
      meta: {
        providerType: "custom",
      },
    });
  });

  it("auto-detects claude mappings and leaves unmatched fields empty", () => {
    const mapping = selectClaudeMapping([
      { id: "claude-3-opus" },
      { id: "claude-3-5-sonnet" },
      { id: "claude-3-5-haiku" },
      { id: "claude-thinking" },
    ]);

    expect(mapping.primary?.id).toBe("claude-3-opus");
    expect(mapping.reasoning?.id).toBe("claude-thinking");
    expect(mapping.haiku?.id).toBe("claude-3-5-haiku");
    expect(mapping.opus?.id).toBe("claude-3-opus");

    const preview = buildBatchProviderPreview(
      "claude",
      {
        fileName: "claude-source.json",
        providerName: "claude-source",
        postUrl: "https://post.example.com/2",
        webUrl: "https://site.example.com/claude",
        webType: "relay",
        baseUrl: "https://claude.example.com",
        apiKey: "sk-claude",
      },
      [{ id: "claude-3-5-sonnet" }, { id: "claude-thinking" }],
    );

    expect(preview.providerInput).toMatchObject({
      name: "claude-source",
      notes: "https://post.example.com/2",
      websiteUrl: "https://site.example.com/claude",
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
      },
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-claude",
          ANTHROPIC_MODEL: "claude-3-5-sonnet",
          ANTHROPIC_REASONING_MODEL: "claude-thinking",
        },
      },
    });
    expect(
      preview.providerInput?.settingsConfig.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    ).toBeUndefined();
  });

  it("builds both claude and codex previews when one source supports both", () => {
    const previews = buildBatchAppPreviews(
      {
        fileName: "dual-source.json",
        providerName: "dual-source",
        postUrl: "https://post.example.com/3",
        webUrl: "https://site.example.com/dual",
        webType: "relay",
        baseUrl: "https://dual.example.com",
        apiKey: "sk-dual",
      },
      [{ id: "claude-3-5-sonnet" }, { id: "gpt-5.4" }],
    );

    expect(previews).toHaveLength(2);
    expect(previews.find((entry) => entry.appId === "claude")?.preview.providerInput)
      .toBeTruthy();
    expect(previews.find((entry) => entry.appId === "codex")?.preview.providerInput)
      .toBeTruthy();
  });
});
