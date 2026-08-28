"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CommitFormProps {
  workingDirectory: string;
  stagedCount: number;
  branch: string;
  repoName?: string;
  multipleReposWarning?: boolean;
  onCommit: () => void;
}

export function CommitForm({
  workingDirectory,
  stagedCount,
  branch,
  repoName,
  multipleReposWarning,
  onCommit,
}: CommitFormProps) {
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canCommit = stagedCount > 0 && message.trim().length > 0;

  const handleCommit = async (): Promise<boolean> => {
    if (!canCommit) return false;

    setError(null);
    setSuccess(null);
    setCommitting(true);

    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDirectory,
          message: message.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Commit failed");
        return false;
      }

      // Clear form
      setMessage("");
      setSuccess("Committed successfully!");
      onCommit();
      return true;
    } catch {
      setError("Failed to commit");
      return false;
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setError(null);
    setSuccess(null);
    setPushing(true);

    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDirectory }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.pushed) {
        setSuccess("Pushed successfully!");
      } else {
        setSuccess(data.message || "Already up to date");
      }

      onCommit();
    } catch {
      setError("Failed to push");
    } finally {
      setPushing(false);
    }
  };

  const handleCommitAndPush = async () => {
    const commitSucceeded = await handleCommit();
    // Only push if commit was successful
    if (commitSucceeded) {
      await handlePush();
    }
  };

  // Only show commit form when there are staged files
  if (stagedCount === 0) {
    return null;
  }

  return (
    <div className="glass glass-edge-top relative z-10 space-y-2 p-3">
      {/* Repo indicator (multi-repo mode) */}
      {repoName && (
        <div className="ui-meta flex items-center gap-1.5">
          Committing to:
          <span className="text-foreground">{repoName}</span>
          <span className="text-muted-foreground/70">({branch})</span>
        </div>
      )}

      {/* Warning for multiple repos with staged changes */}
      {multipleReposWarning && (
        <div className="bg-status-waiting/10 text-status-waiting flex items-start gap-2 px-2 py-1.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>
            Multiple repos have staged changes. Only the first will be
            committed.
          </span>
        </div>
      )}

      {/* Commit message input */}
      <div className="space-y-1.5">
        <label className="ui-label flex items-center gap-2">
          <span>01</span>
          commit.msg
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your changes..."
          rows={3}
          className={cn(
            "border-input bg-background w-full resize-none rounded-md border px-3 py-2.5 font-mono text-xs",
            "focus-visible:border-ring focus-visible:ring-ring/60 focus-visible:ring-1 focus-visible:outline-none",
            "placeholder:text-muted-foreground/50"
          )}
        />
      </div>

      {/* Error message */}
      {error && <p className="text-status-error px-1 text-xs">{error}</p>}

      {/* Success message */}
      {success && <p className="text-status-running px-1 text-xs">{success}</p>}

      {/* Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="default"
          onClick={handleCommit}
          disabled={!canCommit || committing || pushing}
          className="min-h-[44px] flex-1"
        >
          {committing ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              COMMIT
            </>
          ) : (
            "COMMIT"
          )}
        </Button>

        <Button
          variant="default"
          size="default"
          onClick={handleCommitAndPush}
          disabled={!canCommit || committing || pushing}
          className="min-h-[44px] flex-1"
        >
          {pushing ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              COMMIT &amp; PUSH
            </>
          ) : (
            <>
              COMMIT &amp; PUSH
              <ArrowRight className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
