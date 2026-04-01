import type { Provider } from "@/types";
import type { AppId, RemoteProviderModel } from "@/lib/api";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import {
  generateThirdPartyAuth,
  generateThirdPartyConfig,
} from "@/config/codexProviderPresets";

export interface ProviderSourceFile {
  title?: string;
  post_url?: string;
  web_url?: string;
  web_type?: string;
  base_url?: string;
  api_key?: string;
}

export interface ProviderSourceRecord {
  fileName: string;
  providerName: string;
  postUrl?: string;
  webUrl?: string;
  webType?: string;
  baseUrl: string;
  apiKey: string;
}

export interface ClaudeModelMapping {
  primary?: RemoteProviderModel;
  reasoning?: RemoteProviderModel;
  haiku?: RemoteProviderModel;
  sonnet?: RemoteProviderModel;
  opus?: RemoteProviderModel;
}

export interface BatchProviderPreview {
  selectedModel?: RemoteProviderModel;
  claudeMapping?: ClaudeModelMapping;
  providerInput?: Omit<Provider, "id"> & {
    providerKey?: string;
    suggestedDefaults?: OpenClawSuggestedDefaults;
  };
  skipReason?: string;
}

export const BATCH_SUPPORTED_APPS: AppId[] = ["claude", "codex"];

export interface BatchAppPreviewEntry {
  appId: AppId;
  preview: BatchProviderPreview;
}

export const getFileName = (path: string) => path.split("/").pop() || path;

export const getProviderNameFromFileName = (fileName: string) =>
  fileName.replace(/\.json$/i, "");

export const normalizeRootUrl = (baseUrl: string) =>
  baseUrl.trim().replace(/\/+$/, "");

export const normalizeOpenAiBaseUrl = (baseUrl: string) => {
  const root = normalizeRootUrl(baseUrl);
  return /\/v\d+(\/.*)?$/i.test(root) ? root : `${root}/v1`;
};

export const getSourceRecords = (
  modules: Record<string, ProviderSourceFile>,
): ProviderSourceRecord[] =>
  Object.entries(modules)
    .map(([path, raw]) => {
      const fileName = getFileName(path);
      return {
        fileName,
        providerName: getProviderNameFromFileName(fileName),
        postUrl: raw.post_url?.trim() || undefined,
        webUrl: raw.web_url?.trim() || undefined,
        webType: raw.web_type?.trim() || undefined,
        baseUrl: raw.base_url?.trim() || "",
        apiKey: raw.api_key?.trim() || "",
      };
    })
    .filter((record) => record.baseUrl && record.apiKey);

const getModelText = (model: RemoteProviderModel) =>
  `${model.id} ${model.name ?? ""}`.toLowerCase();

const firstMatch = (
  models: RemoteProviderModel[],
  matcher: (model: RemoteProviderModel) => boolean,
) => models.find(matcher);

export const selectCodexModel = (
  models: RemoteProviderModel[],
): RemoteProviderModel | undefined =>
  firstMatch(models, (model) => /codex/i.test(model.id)) ||
  firstMatch(models, (model) => /codex/i.test(getModelText(model))) ||
  firstMatch(models, (model) => /^gpt-5\.4/i.test(model.id)) ||
  firstMatch(models, (model) => /^gpt-5/i.test(model.id)) ||
  firstMatch(models, (model) => /^gpt-5/i.test(getModelText(model)));

export const selectClaudeMapping = (
  models: RemoteProviderModel[],
): ClaudeModelMapping => {
  const claudeModels = models.filter((model) => getModelText(model).includes("claude"));

  const sonnet =
    firstMatch(claudeModels, (model) => getModelText(model).includes("sonnet")) ||
    undefined;
  const opus =
    firstMatch(claudeModels, (model) => getModelText(model).includes("opus")) ||
    undefined;
  const haiku =
    firstMatch(claudeModels, (model) => getModelText(model).includes("haiku")) ||
    undefined;
  const reasoning =
    firstMatch(
      claudeModels,
      (model) =>
        getModelText(model).includes("reason") ||
        getModelText(model).includes("thinking"),
    ) || undefined;

  const primary = opus || sonnet || haiku || claudeModels[0];

  return {
    primary,
    reasoning,
    haiku,
    sonnet,
    opus,
  };
};

const buildCommonProviderFields = (source: ProviderSourceRecord) => ({
  name: source.providerName,
  notes: source.postUrl,
  websiteUrl: source.webUrl,
  category: "third_party" as const,
  icon: source.webType,
  meta: source.webType
    ? {
        providerType: source.webType,
      }
    : undefined,
});

export function buildBatchProviderPreview(
  appId: AppId,
  source: ProviderSourceRecord,
  models: RemoteProviderModel[],
): BatchProviderPreview {
  if (!BATCH_SUPPORTED_APPS.includes(appId)) {
    return { skipReason: "unsupported-app" };
  }

  const apiBaseUrl = normalizeOpenAiBaseUrl(source.baseUrl);

  if (appId === "codex") {
    const selectedModel = selectCodexModel(models);
    if (!selectedModel) {
      return { skipReason: "no-codex-model" };
    }

    return {
      selectedModel,
      providerInput: {
        ...buildCommonProviderFields(source),
        settingsConfig: {
          auth: generateThirdPartyAuth(source.apiKey),
          config: generateThirdPartyConfig(
            source.providerName,
            apiBaseUrl,
            selectedModel.id,
          ),
        },
      },
    };
  }

  const claudeMapping = selectClaudeMapping(models);
  if (!claudeMapping.primary) {
    return {
      claudeMapping,
      skipReason: "no-claude-model",
    };
  }

  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: apiBaseUrl,
    ANTHROPIC_AUTH_TOKEN: source.apiKey,
    ANTHROPIC_MODEL: claudeMapping.primary.id,
  };

  if (claudeMapping.reasoning) {
    env.ANTHROPIC_REASONING_MODEL = claudeMapping.reasoning.id;
  }
  if (claudeMapping.haiku) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = claudeMapping.haiku.id;
  }
  if (claudeMapping.sonnet) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = claudeMapping.sonnet.id;
  }
  if (claudeMapping.opus) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = claudeMapping.opus.id;
  }

  return {
    selectedModel: claudeMapping.primary,
    claudeMapping,
    providerInput: {
      ...buildCommonProviderFields(source),
      meta: {
        ...(source.webType ? { providerType: source.webType } : {}),
        apiFormat: "openai_responses",
      },
      settingsConfig: {
        env,
      },
    },
  };
}

export const buildBatchAppPreviews = (
  source: ProviderSourceRecord,
  models: RemoteProviderModel[],
): BatchAppPreviewEntry[] =>
  BATCH_SUPPORTED_APPS.map((appId) => ({
    appId,
    preview: buildBatchProviderPreview(appId, source, models),
  }));
