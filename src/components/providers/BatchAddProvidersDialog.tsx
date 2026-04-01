import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { providersApi, type AppId, type RemoteProviderModel } from "@/lib/api";
import { useProvidersQuery } from "@/lib/query";
import type { Provider } from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildBatchAppPreviews,
  getSourceRecords,
  type ProviderSourceFile,
  type ProviderSourceRecord,
} from "@/components/providers/batchAddProviders";
import {
  finalizeProviderSubmission,
  getBatchImportAction,
  type BatchImportAction,
} from "@/utils/providerSubmission";

interface BatchAddProvidersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppId;
  onSubmit: (
    appId: AppId,
    provider: Omit<Provider, "id"> & {
      providerKey?: string;
      suggestedDefaults?: OpenClawSuggestedDefaults;
    },
  ) => Promise<void> | void;
}

interface ProviderSourceState extends ProviderSourceRecord {
  status: "idle" | "loading" | "ready" | "error";
  models: RemoteProviderModel[];
  error?: string;
}

interface ImportSummary {
  successCount: number;
  failedCount: number;
}

interface ImportablePreviewEntry {
  appId: AppId;
  fileName: string;
  providerInput: Omit<Provider, "id"> & {
    providerKey?: string;
    suggestedDefaults?: OpenClawSuggestedDefaults;
  };
}

interface PlannedPreviewEntry {
  appId: AppId;
  preview: {
    selectedModel?: RemoteProviderModel;
    claudeMapping?: {
      primary?: RemoteProviderModel;
      reasoning?: RemoteProviderModel;
      haiku?: RemoteProviderModel;
      sonnet?: RemoteProviderModel;
      opus?: RemoteProviderModel;
    };
    providerInput?: Omit<Provider, "id"> & {
      providerKey?: string;
      suggestedDefaults?: OpenClawSuggestedDefaults;
    };
    skipReason?: string;
  };
  finalizedProviderInput?: Omit<Provider, "id"> & {
    providerKey?: string;
    suggestedDefaults?: OpenClawSuggestedDefaults;
  };
  action?: BatchImportAction;
}

const sourceModules = import.meta.glob("../../*.json", {
  eager: true,
  import: "default",
}) as Record<string, ProviderSourceFile>;

export function BatchAddProvidersDialog({
  open,
  onOpenChange,
  onSubmit,
}: BatchAddProvidersDialogProps) {
  const { t } = useTranslation();
  const { data: claudeProvidersData } = useProvidersQuery("claude");
  const { data: codexProvidersData } = useProvidersQuery("codex");
  const [sources, setSources] = useState<ProviderSourceState[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const initialSources = useMemo(() => getSourceRecords(sourceModules), []);
  const existingProvidersByApp = useMemo<Record<AppId, Record<string, Provider>>>(
    () => ({
      claude: claudeProvidersData?.providers ?? {},
      codex: codexProvidersData?.providers ?? {},
      gemini: {},
      opencode: {},
      openclaw: {},
    }),
    [claudeProvidersData?.providers, codexProvidersData?.providers],
  );

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setSources(
      initialSources.map((source) => ({
        ...source,
        status: "idle",
        models: [],
      })),
    );
  }, [open, initialSources]);

  useEffect(() => {
    if (!open || initialSources.length === 0) return;
    void scanSources();
  }, [open, initialSources.length]);

  const scannedSources = useMemo(
    () =>
      sources.map((source) => ({
        ...source,
        appPreviews:
          source.status === "ready"
            ? buildBatchAppPreviews(source, source.models).map<PlannedPreviewEntry>(
                (entry) => {
                  if (!entry.preview.providerInput) {
                    return {
                      ...entry,
                    };
                  }

                  const finalizedProviderInput = finalizeProviderSubmission(
                    entry.appId,
                    entry.preview.providerInput,
                  );

                  return {
                    ...entry,
                    finalizedProviderInput,
                    action: getBatchImportAction(
                      entry.appId,
                      existingProvidersByApp[entry.appId],
                      finalizedProviderInput,
                    ),
                  };
                },
              )
            : [],
      })),
    [existingProvidersByApp, sources],
  );

  const importableEntries = scannedSources.flatMap<ImportablePreviewEntry>(
    (source) =>
      source.appPreviews
        .filter(
          (entry) =>
            entry.finalizedProviderInput &&
            (entry.action === "add" || entry.action === "edit"),
        )
        .map((entry) => ({
          appId: entry.appId,
          fileName: source.fileName,
          providerInput: entry.finalizedProviderInput!,
        })),
  );

  const totalModels = scannedSources.reduce(
    (sum, source) => sum + source.models.length,
    0,
  );
  const planSummary = scannedSources.reduce(
    (summaryCounts, source) => {
      source.appPreviews.forEach((entry) => {
        if (!entry.action) {
          return;
        }
        summaryCounts[entry.action] += 1;
      });
      return summaryCounts;
    },
    { add: 0, edit: 0, same: 0 } as Record<BatchImportAction, number>,
  );

  const getSkipMessage = (appId: AppId, skipReason?: string) => {
    switch (skipReason) {
      case "no-claude-model":
        return t("provider.batchAddNoClaudeModel", {
          defaultValue: "No Claude model matched.",
        });
      case "no-codex-model":
        return t("provider.batchAddNoCodexModel", {
          defaultValue: "No Codex model matched.",
        });
      default:
        return appId === "claude"
          ? t("provider.batchAddNoClaudeModel", {
              defaultValue: "No Claude model matched.",
            })
          : t("provider.batchAddNoCodexModel", {
              defaultValue: "No Codex model matched.",
            });
    }
  };

  const getActionBadge = (action?: BatchImportAction) => {
    if (action === "add") {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t("provider.batchAddWillAdd", {
            defaultValue: "增加",
          })}
        </span>
      );
    }

    if (action === "edit") {
      return (
        <span className="inline-flex items-center gap-1 text-sky-600">
          <RefreshCw className="h-3.5 w-3.5" />
          {t("provider.batchAddWillEdit", {
            defaultValue: "编辑",
          })}
        </span>
      );
    }

    if (action === "same") {
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t("provider.batchAddUnchanged", {
            defaultValue: "完全一样",
          })}
        </span>
      );
    }

    return null;
  };

  async function scanSources() {
    setIsScanning(true);
    setSummary(null);
    setSources((current) =>
      current.map((source) => ({
        ...source,
        status: "loading",
        models: [],
        error: undefined,
      })),
    );

    const nextSources = await Promise.all(
      initialSources.map(async (source) => {
        try {
          const models = await providersApi.fetchSourceModels(
            source.baseUrl,
            source.apiKey,
          );
          return {
            ...source,
            status: "ready" as const,
            models,
          };
        } catch (error) {
          return {
            ...source,
            status: "error" as const,
            models: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    setSources(nextSources);
    setIsScanning(false);
  }

  const handleImport = async () => {
    setIsImporting(true);

    try {
      let successCount = 0;
      let failedCount = 0;

      for (const entry of importableEntries) {
        try {
          await onSubmit(
            entry.appId,
            entry.providerInput,
          );
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          console.error("[BatchAddProvidersDialog] Failed to add provider", {
            source: entry.fileName,
            appId: entry.appId,
            error,
          });
        }
      }

      const skippedCount = scannedSources.reduce(
        (count, source) =>
          count +
          source.appPreviews.filter((entry) => !entry.preview.providerInput).length,
        0,
      );
      failedCount += skippedCount;

      setSummary({ successCount, failedCount });

      if (failedCount === 0 && successCount > 0) {
        toast.success(
          t("provider.batchAddSuccess", {
            defaultValue: "Imported {{count}} providers.",
            count: successCount,
          }),
          { closeButton: true },
        );
        onOpenChange(false);
        return;
      }

      toast.warning(
        t("provider.batchAddPartial", {
          defaultValue: "Imported {{success}} providers, {{failed}} failed.",
          success: successCount,
          failed: failedCount,
        }),
        { closeButton: true },
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" zIndex="top">
        <DialogHeader>
          <DialogTitle>
            {t("provider.batchAddTitle", {
              defaultValue: "Batch Add Providers",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("provider.batchAddDescription", {
              defaultValue:
                "Read source JSON files from src and add providers with the same behavior as the + dialog.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5 overflow-y-auto">
          <div className="flex items-center justify-between rounded-lg border border-border-default bg-muted/20 px-4 py-3 text-sm">
            <div>
              <div className="font-medium text-foreground">
                {t("provider.batchAddTitle", {
                  defaultValue: "Batch Add Providers",
                })}
              </div>
              <div className="mt-1 text-muted-foreground">
                {t("provider.batchAddSummary", {
                  defaultValue:
                    "{{sources}} source files, {{models}} models detected, {{importable}} providers importable",
                  sources: scannedSources.length,
                  models: totalModels,
                  importable: importableEntries.length,
                })}
              </div>
              {!isScanning && (
                <div className="mt-1 text-muted-foreground">
                  {t("provider.batchAddPlanSummary", {
                    defaultValue:
                      "增加 {{add}} 个，编辑 {{edit}} 个，完全一样 {{same}} 个",
                    add: planSummary.add,
                    edit: planSummary.edit,
                    same: planSummary.same,
                  })}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void scanSources()}
              disabled={isScanning}
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("common.refresh")}
            </Button>
          </div>

          {summary && (
            <div className="rounded-lg border border-border-default bg-background px-4 py-3 text-sm">
              <div className="font-medium text-foreground">
                {t("provider.batchAddResultTitle", {
                  defaultValue: "Import results",
                })}
              </div>
              <div className="mt-1 text-muted-foreground">
                {t("provider.batchAddPartial", {
                  defaultValue: "Imported {{success}} providers, {{failed}} failed.",
                  success: summary.successCount,
                  failed: summary.failedCount,
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {scannedSources.map((source) => (
              <div
                key={source.fileName}
                className="rounded-lg border border-border-default bg-background px-4 py-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground break-all">
                      {source.providerName}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground break-all">
                      {source.fileName} | {source.baseUrl}
                    </div>
                    {source.postUrl && (
                      <div className="mt-1 text-xs text-muted-foreground break-all">
                        {source.postUrl}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-xs">
                    {source.status === "loading" && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("provider.batchAddRunning", {
                          defaultValue: "Scanning...",
                        })}
                      </span>
                    )}
                    {source.status === "error" && (
                      <span className="inline-flex items-center gap-1 text-red-500">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {t("common.error")}
                      </span>
                    )}
                  </div>
                </div>

                {source.status === "ready" && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    <div>
                      {t("provider.batchAddModelsDetected", {
                        defaultValue: "{{count}} models detected",
                        count: source.models.length,
                      })}
                    </div>
                    <div className="mt-2 space-y-2">
                      {source.appPreviews.map((entry) => (
                        <div
                          key={`${source.fileName}-${entry.appId}`}
                          className="rounded border border-border-default/60 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-foreground">
                              {t(`apps.${entry.appId}`, {
                                defaultValue: entry.appId,
                              })}
                            </div>
                            {entry.preview.providerInput ? (
                              getActionBadge(entry.action)
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-600">
                                <AlertCircle className="h-3.5 w-3.5" />
                                {getSkipMessage(entry.appId, entry.preview.skipReason)}
                              </span>
                            )}
                          </div>

                          {entry.preview.selectedModel && (
                            <div className="mt-1">
                              {t("provider.batchAddSelectedModel", {
                                defaultValue: "Selected model: {{model}}",
                                model: entry.preview.selectedModel.id,
                              })}
                            </div>
                          )}

                          {entry.appId === "claude" && entry.preview.claudeMapping && (
                            <div className="mt-2 grid grid-cols-1 gap-1">
                              <div>
                                Primary: {entry.preview.claudeMapping.primary?.id || "-"}
                              </div>
                              <div>
                                Reasoning: {entry.preview.claudeMapping.reasoning?.id || "-"}
                              </div>
                              <div>
                                Haiku: {entry.preview.claudeMapping.haiku?.id || "-"}
                              </div>
                              <div>
                                Sonnet: {entry.preview.claudeMapping.sonnet?.id || "-"}
                              </div>
                              <div>
                                Opus: {entry.preview.claudeMapping.opus?.id || "-"}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 max-h-24 overflow-y-auto text-xs break-all">
                      {source.models.map((model) => model.id).join(", ")}
                    </div>
                  </div>
                )}

                {source.status === "error" && source.error && (
                  <div className="mt-3 text-sm text-red-500 break-all">
                    {source.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void handleImport()}
            disabled={
              isImporting || isScanning || importableEntries.length === 0
            }
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isImporting
              ? t("provider.batchAddImporting", {
                  defaultValue: "Importing...",
                })
              : t("provider.batchAddAction", {
                  defaultValue: "Import Providers",
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
