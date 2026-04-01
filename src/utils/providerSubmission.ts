import type { AppId } from "@/lib/api";
import type { Provider, CustomEndpoint } from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import { mergeProviderMeta } from "@/utils/providerMetaUtils";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";

export type ProviderSubmissionInput = Omit<Provider, "id"> & {
  providerKey?: string;
  suggestedDefaults?: OpenClawSuggestedDefaults;
};

interface FinalizeProviderSubmissionOptions {
  presetEndpointCandidates?: string[];
}

export interface BatchProviderIdentity {
  apiKey: string;
  baseUrl: string;
  providerType: string;
}

export type BatchImportAction = "add" | "edit" | "same";

const mergeCustomEndpointsPreservingExisting = (
  existingEndpoints: Record<string, CustomEndpoint> | undefined,
  nextEndpoints: Record<string, CustomEndpoint> | undefined,
): Record<string, CustomEndpoint> | undefined => {
  if (!nextEndpoints) {
    return existingEndpoints;
  }

  return Object.fromEntries(
    Object.entries(nextEndpoints).map(([url, endpoint]) => [
      url,
      existingEndpoints?.[url] ?? endpoint,
    ]),
  );
};

const toCustomEndpoints = (
  urls: string[],
): Record<string, CustomEndpoint> | undefined => {
  if (urls.length === 0) {
    return undefined;
  }

  const now = Date.now();
  const customEndpoints: Record<string, CustomEndpoint> = {};

  urls.forEach((url) => {
    customEndpoints[url] = {
      url,
      addedAt: now,
      lastUsed: undefined,
    };
  });

  return customEndpoints;
};

export const collectDerivedEndpointUrls = (
  appId: AppId,
  provider: ProviderSubmissionInput,
  presetEndpointCandidates: string[] = [],
): string[] => {
  const urlSet = new Set<string>();

  const addUrl = (rawUrl?: string) => {
    const url = (rawUrl || "").trim().replace(/\/+$/, "");
    if (url && url.startsWith("http")) {
      urlSet.add(url);
    }
  };

  presetEndpointCandidates.forEach(addUrl);

  if (appId === "claude") {
    const env = provider.settingsConfig.env as Record<string, unknown> | undefined;
    addUrl(typeof env?.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : "");
  } else if (appId === "codex") {
    const config =
      typeof provider.settingsConfig.config === "string"
        ? provider.settingsConfig.config
        : undefined;
    addUrl(extractCodexBaseUrl(config));
  } else if (appId === "gemini") {
    const env = provider.settingsConfig.env as Record<string, unknown> | undefined;
    addUrl(
      typeof env?.GOOGLE_GEMINI_BASE_URL === "string"
        ? env.GOOGLE_GEMINI_BASE_URL
        : "",
    );
  } else if (appId === "opencode") {
    const options = provider.settingsConfig.options as Record<string, unknown> | undefined;
    addUrl(typeof options?.baseURL === "string" ? options.baseURL : "");
  } else if (appId === "openclaw") {
    addUrl(
      typeof provider.settingsConfig.baseUrl === "string"
        ? provider.settingsConfig.baseUrl
        : "",
    );
  }

  return Array.from(urlSet);
};

export const finalizeProviderSubmission = (
  appId: AppId,
  provider: ProviderSubmissionInput,
  options: FinalizeProviderSubmissionOptions = {},
): ProviderSubmissionInput => {
  const hasCustomEndpoints =
    !!provider.meta?.custom_endpoints &&
    Object.keys(provider.meta.custom_endpoints).length > 0;

  if (hasCustomEndpoints || provider.category === "omo") {
    return provider;
  }

  const customEndpoints = toCustomEndpoints(
    collectDerivedEndpointUrls(appId, provider, options.presetEndpointCandidates),
  );

  if (!customEndpoints) {
    return provider;
  }

  return {
    ...provider,
    meta: mergeProviderMeta(provider.meta, customEndpoints),
  };
};

const normalizeIdentityValue = (value: string | undefined): string =>
  (value || "").trim().replace(/\/+$/, "");

export const getBatchProviderIdentity = (
  appId: AppId,
  provider: Pick<Provider, "settingsConfig" | "meta">,
): BatchProviderIdentity => {
  if (appId === "claude") {
    const env = provider.settingsConfig.env as Record<string, unknown> | undefined;
    return {
      providerType: normalizeIdentityValue(provider.meta?.providerType),
      baseUrl: normalizeIdentityValue(
        typeof env?.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : "",
      ),
      apiKey: normalizeIdentityValue(
        typeof env?.ANTHROPIC_AUTH_TOKEN === "string"
          ? env.ANTHROPIC_AUTH_TOKEN
          : typeof env?.ANTHROPIC_API_KEY === "string"
            ? env.ANTHROPIC_API_KEY
            : "",
      ),
    };
  }

  if (appId === "codex") {
    const auth = provider.settingsConfig.auth as Record<string, unknown> | undefined;
    return {
      providerType: normalizeIdentityValue(provider.meta?.providerType),
      baseUrl: normalizeIdentityValue(
        extractCodexBaseUrl(
          typeof provider.settingsConfig.config === "string"
            ? provider.settingsConfig.config
            : undefined,
        ),
      ),
      apiKey: normalizeIdentityValue(
        typeof auth?.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "",
      ),
    };
  }

  return {
    providerType: "",
    baseUrl: "",
    apiKey: "",
  };
};

export const findMatchingBatchProvider = (
  appId: AppId,
  providers: Record<string, Provider>,
  providerInput: ProviderSubmissionInput,
): Provider | undefined => {
  const nextIdentity = getBatchProviderIdentity(appId, providerInput);

  return Object.values(providers).find((provider) => {
    const currentIdentity = getBatchProviderIdentity(appId, provider);
    return (
      currentIdentity.providerType === nextIdentity.providerType &&
      currentIdentity.baseUrl === nextIdentity.baseUrl &&
      currentIdentity.apiKey === nextIdentity.apiKey
    );
  });
};

export const buildBatchProviderUpdate = (
  existingProvider: Provider,
  providerInput: ProviderSubmissionInput,
): Provider => {
  const mergedMeta = providerInput.meta
    ? {
        ...(existingProvider.meta ?? {}),
        ...providerInput.meta,
      }
    : existingProvider.meta;

  if (mergedMeta?.custom_endpoints) {
    mergedMeta.custom_endpoints = mergeCustomEndpointsPreservingExisting(
      existingProvider.meta?.custom_endpoints,
      mergedMeta.custom_endpoints,
    );
  }

  return {
    ...existingProvider,
    ...providerInput,
    id: existingProvider.id,
    createdAt: existingProvider.createdAt,
    sortIndex: existingProvider.sortIndex,
    meta: mergedMeta,
  };
};

const sortObjectDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortObjectDeep);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortObjectDeep(nestedValue)]),
    );
  }

  return value;
};

const getComparableProviderState = (provider: Provider) =>
  sortObjectDeep({
    name: provider.name,
    notes: provider.notes,
    websiteUrl: provider.websiteUrl,
    settingsConfig: provider.settingsConfig,
    category: provider.category,
    meta: provider.meta,
    icon: provider.icon,
    iconColor: provider.iconColor,
  });

export const isSameBatchProviderContent = (
  existingProvider: Provider,
  providerInput: ProviderSubmissionInput,
): boolean =>
  JSON.stringify(getComparableProviderState(existingProvider)) ===
  JSON.stringify(
    getComparableProviderState(
      buildBatchProviderUpdate(existingProvider, providerInput),
    ),
  );

export const getBatchImportAction = (
  appId: AppId,
  providers: Record<string, Provider>,
  providerInput: ProviderSubmissionInput,
): BatchImportAction => {
  const matchedProvider = findMatchingBatchProvider(appId, providers, providerInput);

  if (!matchedProvider) {
    return "add";
  }

  return isSameBatchProviderContent(matchedProvider, providerInput)
    ? "same"
    : "edit";
};
