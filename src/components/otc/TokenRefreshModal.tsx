'use client';

import { useState } from 'react';
import { AlertCircle, RefreshCw, X, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TokenRefreshModalProps {
  open: boolean;
  onClose: () => void;
  onRefreshed: () => void;
}

export function TokenRefreshModal({ open, onClose, onRefreshed }: TokenRefreshModalProps) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!token.trim() || token.trim().length < 10) {
      setResult({ ok: false, message: 'Token too short — paste a valid Quotex session token.' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/token-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ ok: true, message: data.message ?? 'Token accepted — reconnecting.' });
        setToken('');
        setTimeout(() => {
          onRefreshed();
          onClose();
        }, 6000);
      } else {
        setResult({ ok: false, message: data.error ?? 'Refresh failed.' });
      }
    } catch (e: any) {
      setResult({ ok: false, message: `Network error: ${e.message}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-rose-200 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-100 text-rose-600 shrink-0">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-rose-700">Quotex Token Expired</h3>
            <p className="text-xs text-muted-foreground mt-1">
              The app has stopped producing signals because the Quotex session token expired.
              Paste a fresh token below to resume — the engine will reconnect automatically
              and start live signals again.
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Fresh Quotex token
            </label>
            <a
              href="https://market-qx.trade/en/trade"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open Quotex
            </a>
          </div>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste token here (e.g. SnEUFvQZMQudR8FefYgf0NAkGwDd0CN3Hu3Zkps0)"
            className="w-full h-20 px-3 py-2 text-xs font-mono rounded-md border bg-card resize-none focus:outline-none focus:ring-2 focus:ring-rose-300"
            disabled={submitting}
          />
          <div className="bg-muted/40 rounded-md p-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">
              📋 Token বের করার সহজ উপায়:
            </p>
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium">উপায় ১ (সবচেয়ে সহজ):</span> Quotex-এ login করুন → F12 চাপুন → Console-এ paste করুন:
            </p>
            <code className="block text-[10px] bg-background px-2 py-1.5 rounded font-mono break-all">
              copy(window.settings.token)
            </code>
            <p className="text-[10px] text-muted-foreground">
              Token clipboard-এ copy হবে → উপরের box-ে paste করুন।
            </p>
            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/50">
              <span className="font-medium">উপায় ২:</span> Console-এ <code className="bg-background px-1 py-0.5 rounded">window.settings.token</code> লিখে Enter চাপুন, যে token দেখাবে copy করুন।
            </p>
          </div>
        </div>

        {result && (
          <div
            className={cn(
              'rounded-md p-3 text-xs border',
              result.ok
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            )}
          >
            {result.message}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {result?.ok ? (
            <Button
              size="sm"
              onClick={() => {
                onRefreshed();
                onClose();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Done
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !token.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {submitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Reconnecting…
                </>
              ) : (
                'Refresh Token'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
