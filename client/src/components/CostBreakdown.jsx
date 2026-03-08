import { useMemo } from 'react';

/**
 * Language code to display name mapping.
 */
const LANGUAGE_NAMES = {
  auto: 'Auto-detect',
  en: 'English',
  ja: 'Japanese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  th: 'Thai',
  vi: 'Vietnamese'
};

function getLangName(code) {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

/**
 * CostBreakdown -- shows the estimated cost before job creation.
 * Displays a line-item breakdown and "Generate Subtitles" button.
 */
export default function CostBreakdown({
  audioSeconds,
  language,
  additionalLanguages,
  balance,
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
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Cost Estimate
        </h1>
        <p className="text-sm text-gray-500">
          Review the credit cost before generating subtitles.
        </p>
      </div>

      {/* Breakdown card */}
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {/* Line items */}
        <div className="mb-6 space-y-3">
          {/* Primary language */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">
                {getLangName(language)}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                primary
              </span>
            </div>
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {breakdown.baseMinutes} min
            </span>
          </div>

          {/* Additional languages */}
          {additionalLanguages?.map(lang => (
            <div key={lang} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">
                  {getLangName(lang)}
                </span>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  half rate
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-gray-900">
                {breakdown.translationCost} min
              </span>
            </div>
          ))}

          {/* Divider */}
          <div className="border-t border-gray-200 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Total</span>
              <span className="text-lg font-bold tabular-nums text-brand-600">
                {breakdown.totalMinutes} min
              </span>
            </div>
          </div>
        </div>

        {/* Balance info */}
        <div className={`mb-6 rounded-lg px-4 py-3 ${
          hasSufficientCredits
            ? 'bg-gray-50'
            : 'bg-amber-50 border border-amber-200'
        }`}>
          {balance !== null ? (
            <div className="flex items-center justify-between text-sm">
              <span className={hasSufficientCredits ? 'text-gray-600' : 'text-amber-700'}>
                {hasSufficientCredits
                  ? 'Your balance'
                  : 'Insufficient credits'
                }
              </span>
              <div className="text-right">
                <span className={`font-semibold tabular-nums ${
                  hasSufficientCredits ? 'text-gray-900' : 'text-amber-700'
                }`}>
                  {balance} min
                </span>
                {hasSufficientCredits && balanceAfter !== null && (
                  <span className="ml-2 text-xs text-gray-400">
                    ({balanceAfter} min remaining after)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Loading balance...</div>
          )}
        </div>

        {/* Insufficient credits warning */}
        {!hasSufficientCredits && balance !== null && (
          <div className="mb-6">
            <p className="mb-3 text-sm text-amber-700">
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
