import { useMemo } from 'react';
import langConfig from '../../../shared/languages.js';
const { getLangName } = langConfig;

/**
 * CostBreakdown -- shows the estimated cost before job creation.
 * Displays a line-item breakdown and "Generate Subtitles" button.
 */
export default function CostBreakdown({
  audioSeconds,
  language,
  additionalLanguages,
  balance,
  thumbnailUrl,
  onConfirm,
  onBack,
  onBuyCredits
}) {
  const breakdown = useMemo(() => {
    const baseMinutes = Math.ceil(audioSeconds / 60);
    const translationCost = Math.ceil(baseMinutes * 0.5);
    const additionalCount = additionalLanguages?.length || 0;
    const totalMinutes = baseMinutes + (additionalCount * translationCost);

    return {
      baseMinutes,
      translationCost,
      additionalCount,
      totalMinutes
    };
  }, [audioSeconds, additionalLanguages]);

  const hasSufficientCredits = balance !== null && balance >= breakdown.totalMinutes;
  const balanceAfter = balance !== null ? balance - breakdown.totalMinutes : null;

  return (
    <div className="flex flex-col items-center">
      {/* Header */}
      <div className="mb-8 text-center">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="mx-auto mb-4 h-32 w-auto rounded-lg shadow-sm"
          />
        )}
        <h1 className="mb-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
          Cost Estimate
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Review the credit cost before generating subtitles.
        </p>
      </div>

      {/* Breakdown card */}
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        {/* Line items */}
        <div className="mb-6 space-y-3">
          {/* Primary language */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-700 dark:text-stone-300">
                {getLangName(language)}
              </span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                primary
              </span>
            </div>
            <span className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
              {breakdown.baseMinutes} min
            </span>
          </div>

          {/* Additional languages */}
          {additionalLanguages?.map(lang => (
            <div key={lang} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone-700 dark:text-stone-300">
                  {getLangName(lang)}
                </span>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
                  half rate
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                {breakdown.translationCost} min
              </span>
            </div>
          ))}

          {/* Divider */}
          <div className="border-t border-stone-200 pt-3 dark:border-stone-700">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">Total</span>
              <span className="text-lg font-bold tabular-nums text-brand-600 dark:text-brand-400">
                {breakdown.totalMinutes} min
              </span>
            </div>
          </div>
        </div>

        {/* Balance info */}
        <div className={`mb-6 rounded-lg px-4 py-3 ${
          hasSufficientCredits
            ? 'bg-stone-50 dark:bg-stone-800'
            : 'bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800'
        }`}>
          {balance !== null ? (
            <div className="flex items-center justify-between text-sm">
              <span className={hasSufficientCredits ? 'text-stone-600 dark:text-stone-400' : 'text-amber-700 dark:text-amber-400'}>
                {hasSufficientCredits
                  ? 'Your balance'
                  : 'Insufficient credits'
                }
              </span>
              <div className="text-right">
                <span className={`font-semibold tabular-nums ${
                  hasSufficientCredits ? 'text-stone-900 dark:text-stone-100' : 'text-amber-700 dark:text-amber-400'
                }`}>
                  {balance} min
                </span>
                {hasSufficientCredits && balanceAfter !== null && (
                  <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                    ({balanceAfter} min remaining after)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-stone-500 dark:text-stone-400">Loading balance...</div>
          )}
        </div>

        {/* Insufficient credits warning */}
        {!hasSufficientCredits && balance !== null && (
          <div className="mb-6">
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
              You need <span className="font-semibold">{breakdown.totalMinutes - balance} more minutes</span> to generate these subtitles.
            </p>
            <button
              onClick={onBuyCredits}
              className="btn-primary w-full"
            >
              Buy Credits
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost">
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={!hasSufficientCredits}
            className="btn-primary flex-1"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Generate Subtitles
          </button>
        </div>
      </div>
    </div>
  );
}
