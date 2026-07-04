"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";

import { fetchMailboConfig, testMailboConfig, updateMailboConfig } from "./endpoints";

interface MailboTabProps {
  siteId: number;
  disabled?: boolean;
}

export function MailboTab({ siteId, disabled = false }: MailboTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState("");

  useEffect(() => {
    let active = true;
    fetchMailboConfig(siteId)
      .then(cfg => {
        if (!active) return;
        setEnabled(cfg.enabled);
        setHasApiKey(cfg.hasApiKey);
        setApiKeyMasked(cfg.apiKeyMasked);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [siteId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateMailboConfig(siteId, {
        enabled,
        // send apiKey only when the user typed a new one
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      });
      const cfg = await fetchMailboConfig(siteId);
      setHasApiKey(cfg.hasApiKey);
      setApiKeyMasked(cfg.apiKeyMasked);
      setApiKey("");
      toast.success("Mailbo settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save Mailbo settings");
    } finally {
      setSaving(false);
    }
  }, [siteId, enabled, apiKey]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await testMailboConfig(siteId);
      if (res.ok) toast.success("Connected to Mailbo");
      else toast.error(`Mailbo connection failed: ${res.error ?? "unknown"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }, [siteId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Push behavioral intent (tools explored, pricing views, checkout intent, lifecycle milestones) into
        Mailbo contacts, keyed by email. Only human-readable <code>intent_*</code> fields and de-duplicated
        milestones are sent — never raw clickstreams or secrets.
      </p>

      <div className="flex items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div>
          <Label className="text-sm font-medium">Enable Mailbo sync</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Requires a saved API key.</p>
        </div>
        <Switch checked={enabled} disabled={disabled} onCheckedChange={setEnabled} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="mailbo-api-key" className="text-sm font-medium">
          Mailbo API key
        </Label>
        <Input
          id="mailbo-api-key"
          type="password"
          autoComplete="off"
          placeholder={hasApiKey ? `Saved (${apiKeyMasked}) — type to replace` : "Paste your Mailbo API key"}
          value={apiKey}
          disabled={disabled}
          onChange={e => setApiKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Stored server-side and never shown again. Get it from mailbo.io → API settings.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={disabled || saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Save
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={disabled || testing || !hasApiKey}>
          {testing && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Test connection
        </Button>
      </div>
    </div>
  );
}
