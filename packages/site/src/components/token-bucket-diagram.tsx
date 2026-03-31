'use client';

interface TokenBucketDiagramProps {
    tokens: number;
    capacity: number;
    refillRate: number;
    refillMs: number;
}

function formatRefillRate(refillRate: number, refillMs: number): string {
    if (refillMs === 1000) return `${String(refillRate)} token${refillRate === 1 ? '' : 's'}/sec`;
    if (refillMs === 10_000) return `${String(refillRate)} token${refillRate === 1 ? '' : 's'}/10s`;
    if (refillMs === 30_000) return `${String(refillRate)} token${refillRate === 1 ? '' : 's'}/30s`;
    if (refillMs === 60_000) return `${String(refillRate)} token${refillRate === 1 ? '' : 's'}/min`;
    return `${String(refillRate)} token${refillRate === 1 ? '' : 's'}/${String(refillMs / 1000)}s`;
}

function formatTime(seconds: number): string {
    if (seconds <= 0) return '0s';
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    return `${String(Math.ceil(seconds))}s`;
}

export function TokenBucketDiagram({ tokens, capacity, refillRate, refillMs }: TokenBucketDiagramProps) {
    const displayTokens = Math.floor(tokens);
    const tokensPerMs = refillRate / refillMs;
    const isFull = tokens >= capacity;

    // Time until next whole token
    const fractional = tokens - displayTokens;
    const msUntilNextToken = isFull ? 0 : (1 - fractional) / tokensPerMs;
    const secsUntilNextToken = msUntilNextToken / 1000;

    // Time until full
    const msUntilFull = isFull ? 0 : (capacity - tokens) / tokensPerMs;
    const secsUntilFull = msUntilFull / 1000;

    return (
        <div className="space-y-2">
            {/* Header: label + rate */}
            <div className="flex items-center justify-between text-[10px] font-medium">
                <span className="text-violet-600/70 dark:text-violet-400/70">Token Bucket</span>
                <span className="tabular-nums text-violet-600/70 dark:text-violet-400/70">{formatRefillRate(refillRate, refillMs)}</span>
            </div>

            {/* Discrete token blocks */}
            <div className="flex gap-0.5">
                {Array.from({ length: capacity }, (_, i) => {
                    const isFilled = i < displayTokens;
                    const isPartial = !isFilled && i === displayTokens && fractional > 0 && !isFull;
                    return (
                        <div
                            key={i}
                            className={`h-6 flex-1 rounded-sm transition-all duration-150 ${
                                isFilled
                                    ? 'bg-violet-500 dark:bg-violet-400'
                                    : isPartial
                                      ? 'bg-violet-500/30 dark:bg-violet-400/20'
                                      : 'bg-gray-200 dark:bg-gray-700'
                            }`}
                        />
                    );
                })}
            </div>

            {/* Timing info */}
            <div className="flex items-center justify-between text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                <span>
                    {String(displayTokens)} / {String(capacity)} tokens
                </span>
                <div className="flex gap-3">
                    {!isFull && (
                        <span>
                            next token in{' '}
                            <span className="font-medium text-violet-600/70 dark:text-violet-400/70">{formatTime(secsUntilNextToken)}</span>
                        </span>
                    )}
                    <span>
                        {isFull ? (
                            <span className="font-medium text-green-600/70 dark:text-green-400/70">full</span>
                        ) : (
                            <>
                                full in{' '}
                                <span className="font-medium text-violet-600/70 dark:text-violet-400/70">{formatTime(secsUntilFull)}</span>
                            </>
                        )}
                    </span>
                </div>
            </div>
        </div>
    );
}
