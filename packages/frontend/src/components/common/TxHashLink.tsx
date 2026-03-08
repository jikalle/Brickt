import { useState } from 'react';
import { buildTxExplorerUrl, formatTxHash } from '../../lib/txHash';

type TxHashLinkProps = {
  txHash: string;
  compact?: boolean;
  className?: string;
};

const CopyIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
    />
  </svg>
);

const ExternalIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4m4-6h-8m4 0-4-4m4 4L5 19" />
  </svg>
);

export default function TxHashLink({ txHash, compact = false, className = '' }: TxHashLinkProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(txHash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const baseClasses = compact
    ? 'inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/20 px-2 py-1 text-[11px]'
    : 'inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/20 px-3 py-1.5 text-xs';

  return (
    <span className={`${baseClasses} ${className}`.trim()}>
      <a
        href={buildTxExplorerUrl(txHash)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
        title="View transaction on BaseScan"
      >
        <span className="font-mono">{formatTxHash(txHash)}</span>
        <ExternalIcon className="h-3.5 w-3.5" />
      </a>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
        title="Copy transaction hash"
      >
        <CopyIcon className="h-3.5 w-3.5" />
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </span>
  );
}

