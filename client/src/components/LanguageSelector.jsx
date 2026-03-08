import { useState, useCallback } from 'react';

/**
 * Available languages for transcription and translation.
 */
const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: 'Japanese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' }
];

/**
 * Languages available for additional translations (excludes auto-detect).
 */
const TRANSLATION_LANGUAGES = LANGUAGES.filter(l => l.code !== 'auto');

/**
 * LanguageSelector -- shown after audio extraction.
 * Lets user pick a target language and optionally add translation languages.
 *
 * @param {string} fileName - Name of the uploaded file
 * @param {string|null} detectedLanguage - 2-letter ISO 639-1 code detected from the audio track (e.g. 'ja')
 * @param {function} onConfirm - Called with { language, additional_languages }
 * @param {function} onBack - Called when user clicks Back
 */
export default function LanguageSelector({ fileName, detectedLanguage, onConfirm, onBack }) {
  // Default to detected language if available, otherwise auto-detect
  const defaultLang = detectedLanguage && LANGUAGES.some(l => l.code === detectedLanguage)
    ? detectedLanguage
    : 'auto';

  const [primaryLanguage, setPrimaryLanguage] = useState(defaultLang);
  const [showAdditional, setShowAdditional] = useState(false);
  const [additionalLanguages, setAdditionalLanguages] = useState([]);

  /**
   * Toggle an additional language in/out of the selection.
   */
  const toggleLanguage = useCallback((code) => {
    setAdditionalLanguages(prev => {
      if (prev.includes(code)) {
        return prev.filter(c => c !== code);
      }
      return [...prev, code];
    });
  }, []);

  /**
   * Get the list of additional languages available (exclude the primary).
   */
  const availableTranslations = TRANSLATION_LANGUAGES.filter(l =>
    l.code !== primaryLanguage
  );

  /**
   * Handle confirmation.
   */
  const handleConfirm = useCallback(() => {
    onConfirm({
      language: primaryLanguage,
      additional_languages: additionalLanguages.filter(l => l !== primaryLanguage)
    });
  }, [primaryLanguage, additionalLanguages, onConfirm]);

  return (
    <div className="flex flex-col items-center">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Language Settings
        </h1>
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-700">{fileName}</span>
        </p>
      </div>

      {/* Settings card */}
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {/* Target language */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            Target Language
          </label>
          <p className="mb-3 text-xs text-gray-500">
            The spoken language in the audio. Subtitles will be generated in this language.
            {detectedLanguage && primaryLanguage === detectedLanguage && (
              <span className="ml-1 text-brand-600">(detected from audio track)</span>
            )}
          </p>
          <select
            value={primaryLanguage}
            onChange={(e) => {
              setPrimaryLanguage(e.target.value);
              // Remove from additional if user switches primary to a lang that was additional
              setAdditionalLanguages(prev => prev.filter(l => l !== e.target.value));
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="mb-6 border-t border-gray-100" />

        {/* Additional languages toggle */}
        {!showAdditional ? (
          <div className="mb-6">
            <button
              onClick={() => setShowAdditional(true)}
              className="flex items-center gap-2 text-sm font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add translation languages
            </button>
            <p className="mt-2 text-xs text-gray-400">
              Get subtitles in additional languages at half the credit cost per language.
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">
                Additional Languages
              </label>
              <button
                onClick={() => { setShowAdditional(false); setAdditionalLanguages([]); }}
                className="text-xs text-gray-400 transition-colors hover:text-gray-600"
              >
                Remove
              </button>
            </div>

            {/* Info box */}
            <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-brand-50 px-4 py-3">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <p className="text-xs text-brand-700">
                In addition to subtitles for the target language above, you can generate
                translated subtitles in other languages. Each additional language costs
                <span className="font-semibold"> 50% fewer credits</span> than the primary.
              </p>
            </div>

            {/* Language chips */}
            <div className="flex flex-wrap gap-2">
              {availableTranslations.map(lang => {
                const isSelected = additionalLanguages.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    onClick={() => toggleLanguage(lang.code)}
                    className={`
                      rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-150
                      ${isSelected
                        ? 'border-brand-300 bg-brand-50 text-brand-700 shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                      }
                    `}
                  >
                    {isSelected && (
                      <svg className="mr-1 -ml-0.5 inline h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {lang.name}
                  </button>
                );
              })}
            </div>

            {additionalLanguages.length > 0 && (
              <button
                onClick={() => setAdditionalLanguages([])}
                className="mt-3 text-xs text-gray-400 transition-colors hover:text-gray-600"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost">
            Back
          </button>
          <button
            onClick={handleConfirm}
            className="btn-primary flex-1"
          >
            {additionalLanguages.length > 0
              ? `Continue with ${1 + additionalLanguages.length} languages`
              : 'Continue'
            }
          </button>
        </div>
      </div>
    </div>
  );
}
