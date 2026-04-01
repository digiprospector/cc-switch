import { describe, expect, it } from "vitest";
import type { Provider } from "@/types";
import {
  buildBatchProviderUpdate,
  finalizeProviderSubmission,
  findMatchingBatchProvider,
  getBatchImportAction,
  isSameBatchProviderContent,
} from "@/utils/providerSubmission";

describe("providerSubmission", () => {
  it("adds claude custom endpoints from the derived base url", () => {
    const provider = finalizeProviderSubmission("claude", {
      name: "claude-batch",
      category: "third_party",
      websiteUrl: "https://site.example.com",
      notes: "https://post.example.com",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1/",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-sonnet-4.5",
        },
      },
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
      },
    });

    expect(provider.meta).toMatchObject({
      providerType: "relay",
      apiFormat: "openai_responses",
      custom_endpoints: {
        "https://claude.example.com/v1": {
          url: "https://claude.example.com/v1",
          addedAt: expect.any(Number),
          lastUsed: undefined,
        },
      },
    });
  });

  it("adds codex custom endpoints from toml config", () => {
    const provider = finalizeProviderSubmission("codex", {
      name: "codex-batch",
      category: "third_party",
      settingsConfig: {
        auth: { OPENAI_API_KEY: "sk-test" },
        config: [
          'model_provider = "batch"',
          'model = "gpt-5.4"',
          "",
          "[model_providers.batch]",
          'name = "batch"',
          'base_url = "https://codex.example.com/v1"',
          'wire_api = "responses"',
        ].join("\n"),
      },
    });

    expect(provider.meta?.custom_endpoints).toEqual({
      "https://codex.example.com/v1": {
        url: "https://codex.example.com/v1",
        addedAt: expect.any(Number),
        lastUsed: undefined,
      },
    });
  });

  it("keeps existing custom endpoints unchanged", () => {
    const provider = finalizeProviderSubmission("claude", {
      name: "already-customized",
      category: "third_party",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://ignored.example.com",
        },
      },
      meta: {
        custom_endpoints: {
          "https://existing.example.com": {
            url: "https://existing.example.com",
            addedAt: 1,
          },
        },
      },
    });

    expect(provider.meta?.custom_endpoints).toEqual({
      "https://existing.example.com": {
        url: "https://existing.example.com",
        addedAt: 1,
      },
    });
  });

  it("matches existing claude providers by type, base_url and api_key", () => {
    const providerInput = finalizeProviderSubmission("claude", {
      name: "source-name",
      category: "third_party",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-opus",
        },
      },
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
      },
    });

    const existingProvider: Provider = {
      id: "claude-1",
      name: "old-name",
      category: "third_party",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1/",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-sonnet",
        },
      },
      meta: {
        providerType: "relay",
        usage_script: {
          enabled: true,
          language: "javascript",
          code: "return 1;",
        },
      },
      createdAt: 1,
      sortIndex: 2,
    };

    expect(
      findMatchingBatchProvider("claude", { [existingProvider.id]: existingProvider }, providerInput)
        ?.id,
    ).toBe(existingProvider.id);

    expect(buildBatchProviderUpdate(existingProvider, providerInput)).toMatchObject({
      id: "claude-1",
      name: "source-name",
      createdAt: 1,
      sortIndex: 2,
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
        usage_script: {
          enabled: true,
          language: "javascript",
          code: "return 1;",
        },
      },
    });
  });

  it("matches existing codex providers by type, base_url and api_key", () => {
    const providerInput = finalizeProviderSubmission("codex", {
      name: "codex-source",
      category: "third_party",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "sk-codex",
        },
        config: [
          'model_provider = "relay"',
          'model = "gpt-5-codex"',
          "",
          "[model_providers.relay]",
          'name = "relay"',
          'base_url = "https://codex.example.com/v1"',
          'wire_api = "responses"',
        ].join("\n"),
      },
      meta: {
        providerType: "relay",
      },
    });

    const existingProvider: Provider = {
      id: "codex-1",
      name: "old-codex",
      category: "third_party",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "sk-codex",
        },
        config: [
          'model_provider = "relay"',
          'model = "gpt-5.4"',
          "",
          "[model_providers.relay]",
          'name = "relay"',
          'base_url = "https://codex.example.com/v1/"',
          'wire_api = "responses"',
        ].join("\n"),
      },
      meta: {
        providerType: "relay",
      },
    };

    expect(
      findMatchingBatchProvider("codex", { [existingProvider.id]: existingProvider }, providerInput)
        ?.id,
    ).toBe(existingProvider.id);
  });

  it("returns edit when a matched provider has different content", () => {
    const providerInput = finalizeProviderSubmission("claude", {
      name: "updated-name",
      notes: "https://post.example.com/new",
      category: "third_party",
      websiteUrl: "https://site.example.com/new",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-opus",
        },
      },
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
      },
    });

    const existingProvider: Provider = {
      id: "claude-edit",
      name: "old-name",
      notes: "https://post.example.com/old",
      websiteUrl: "https://site.example.com/old",
      category: "third_party",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-sonnet",
        },
      },
      meta: {
        providerType: "relay",
      },
      createdAt: 10,
      sortIndex: 20,
    };

    expect(
      getBatchImportAction(
        "claude",
        { [existingProvider.id]: existingProvider },
        providerInput,
      ),
    ).toBe("edit");
    expect(isSameBatchProviderContent(existingProvider, providerInput)).toBe(false);
  });

  it("returns same when a matched provider is fully identical after normalization", () => {
    const providerInput = finalizeProviderSubmission("codex", {
      name: "codex-source",
      notes: "https://post.example.com/codex",
      websiteUrl: "https://site.example.com/codex",
      category: "third_party",
      icon: "relay",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "sk-codex",
        },
        config: [
          'model_provider = "relay"',
          'model = "gpt-5-codex"',
          "",
          "[model_providers.relay]",
          'name = "relay"',
          'base_url = "https://codex.example.com/v1"',
          'wire_api = "responses"',
        ].join("\n"),
      },
      meta: {
        providerType: "relay",
      },
    });

    const existingProvider = {
      id: "codex-same",
      createdAt: 1,
      sortIndex: 2,
      ...providerInput,
    } satisfies Provider;

    expect(isSameBatchProviderContent(existingProvider, providerInput)).toBe(true);
    expect(
      getBatchImportAction(
        "codex",
        { [existingProvider.id]: existingProvider },
        providerInput,
      ),
    ).toBe("same");
  });

  it("treats derived custom endpoints with different timestamps as the same batch provider content", () => {
    const providerInput = finalizeProviderSubmission("claude", {
      name: "claude-source",
      notes: "https://post.example.com/claude",
      websiteUrl: "https://site.example.com/claude",
      category: "third_party",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-opus",
        },
      },
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
      },
    });

    const existingProvider: Provider = {
      id: "claude-same-endpoint",
      name: "claude-source",
      notes: "https://post.example.com/claude",
      websiteUrl: "https://site.example.com/claude",
      category: "third_party",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
          ANTHROPIC_MODEL: "claude-opus",
        },
      },
      meta: {
        providerType: "relay",
        apiFormat: "openai_responses",
        custom_endpoints: {
          "https://claude.example.com/v1": {
            url: "https://claude.example.com/v1",
            addedAt: 1,
            lastUsed: 2,
          },
        },
      },
      createdAt: 1,
      sortIndex: 2,
    };

    expect(
      buildBatchProviderUpdate(existingProvider, providerInput).meta?.custom_endpoints,
    ).toEqual(existingProvider.meta?.custom_endpoints);
    expect(isSameBatchProviderContent(existingProvider, providerInput)).toBe(true);
    expect(
      getBatchImportAction(
        "claude",
        { [existingProvider.id]: existingProvider },
        providerInput,
      ),
    ).toBe("same");
  });

  it("returns add when no matched provider exists", () => {
    const providerInput = finalizeProviderSubmission("codex", {
      name: "new-codex",
      category: "third_party",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "sk-new",
        },
        config: [
          'model_provider = "relay"',
          'model = "gpt-5-codex"',
          "",
          "[model_providers.relay]",
          'name = "relay"',
          'base_url = "https://new.example.com/v1"',
          'wire_api = "responses"',
        ].join("\n"),
      },
      meta: {
        providerType: "relay",
      },
    });

    expect(getBatchImportAction("codex", {}, providerInput)).toBe("add");
  });
});
