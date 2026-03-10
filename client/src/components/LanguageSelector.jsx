import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import langConfig from '../../../shared/languages.js';
const { LANGUAGES, AUTO_DETECT, getLangName } = langConfig;

/**
 * Searchable single-select dropdown.
 */
function SearchableSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.name.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => { setHighlightIndex(0); }, [filtered]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = useCallback((code) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[highlightIndex]) {
      e.preventDefault();
      select(filtered[highlightIndex].code);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }, [filtered, highlightIndex, select]);

  const selectedName = options.find(o => o.code === value)?.name || value;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex w-full cursor-text items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm shadow-sm transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-stone-600 dark:bg-stone-800"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {!open && value && (
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-sm font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {selectedName}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[80px] flex-1 bg-transparent text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
          placeholder={open ? 'Type to search...' : (value ? '' : placeholder)}
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <svg className="h-4 w-4 flex-shrink-0 text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-400 dark:text-stone-500">No languages found</div>
          ) : (
            filtered.map((opt, i) => (
              <button
                key={opt.code}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                  i === highlightIndex
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
                onMouseEnter={() => setHighlightIndex(i)}
                onClick={() => select(opt.code)}
              >
                <span>{opt.name}</span>
                {opt.code === value && (
                  <svg className="h-4 w-4 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select tag input with autocomplete.
 */
function TagInput({ options, selected, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const available = useMemo(() => {
    const set = new Set(selected);
    let opts = options.filter(o => !set.has(o.code));
    if (query) {
      const q = query.toLowerCase();
      opts = opts.filter(o => o.name.toLowerCase().includes(q));
    }
    return opts;
  }, [options, selected, query]);

  useEffect(() => { setHighlightIndex(0); }, [available]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const add = useCallback((code) => {
    onChange([...selected, code]);
    setQuery('');
    inputRef.current?.focus();
  }, [selected, onChange]);

  const remove = useCallback((code) => {
    onChange(selected.filter(c => c !== code));
  }, [selected, onChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, available.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && available[highlightIndex]) {
      e.preventDefault();
      add(available[highlightIndex].code);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }, [query, selected, available, highlightIndex, add, onChange]);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-stone-600 dark:bg-stone-800"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map(code => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-sm font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300"
          >
            {getLangName(code)}
            <button
              onClick={(e) => { e.stopPropagation(); remove(code); }}
              className="ml-0.5 rounded hover:text-brand-900 dark:hover:text-brand-100"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[80px] flex-1 bg-transparent text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
          placeholder={selected.length === 0 ? placeholder : 'Add language...'}
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800">
          {available.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-400 dark:text-stone-500">
              {query ? 'No languages found' : 'All languages selected'}
            </div>
          ) : (
            available.map((opt, i) => (
              <button
                key={opt.code}
                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                  i === highlightIndex
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
                onMouseEnter={() => setHighlightIndex(i)}
                onClick={() => add(opt.code)}
              >
                {opt.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** All options for the primary dropdown: Auto-detect + all languages. */
const PRIMARY_OPTIONS = [AUTO_DETECT, ...LANGUAGES];

/**
 * LanguageSelector -- shown after audio extraction.
 * Lets user pick a target language and optionally add translation languages.
 *
 * @param {string} fileName - Name of the uploaded file
 * @param {string|null} detectedLanguage - 2-letter ISO 639-1 code detected from the audio track (e.g. 'ja')
 * @param {function} onConfirm - Called with { language, additional_languages }
 * @param {function} onBack - Called when user clicks Back
 */
export default function LanguageSelector({ fileName, detectedLanguage, thumbnailUrl, onConfirm, onBack }) {
  // Default to detected language if available, otherwise auto-detect
  const defaultLang = detectedLanguage && LANGUAGES.some(l => l.code === detectedLanguage)
    ? detectedLanguage
    : 'auto';

  const [primaryLanguage, setPrimaryLanguage] = useState(defaultLang);
  const [showAdditional, setShowAdditional] = useState(false);
  const [additionalLanguages, setAdditionalLanguages] = useState([]);

  /** Languages available for additional translations (exclude primary). */
  const additionalOptions = useMemo(
    () => LANGUAGES.filter(l => l.code !== primaryLanguage),
    [primaryLanguage]
  );

  const handlePrimaryChange = useCallback((code) => {
    setPrimaryLanguage(code);
    // Remove from additional if user switches primary to a lang that was additional
    setAdditionalLanguages(prev => prev.filter(l => l !== code));
  }, []);

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
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="mx-auto mb-4 h-44 w-auto rounded-xl border border-stone-200 shadow-lg dark:border-stone-700"
          />
        )}
        <h1 className="mb-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
          Language Settings
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          <span className="font-medium text-stone-700 dark:text-stone-300">{fileName}</span>
        </p>
      </div>

      {/* Settings card */}
      <div className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        {/* Target language */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-semibold text-stone-700 dark:text-stone-300">
            Target Language
          </label>
          <p className="mb-3 text-xs text-stone-500 dark:text-stone-400">
            The spoken language in the audio. Subtitles will be generated in this language.
            {detectedLanguage && primaryLanguage === detectedLanguage && (
              <span className="ml-1 text-brand-600 dark:text-brand-400">(detected from audio track)</span>
            )}
          </p>
          <SearchableSelect
            options={PRIMARY_OPTIONS}
            value={primaryLanguage}
            onChange={handlePrimaryChange}
            placeholder="Search languages..."
          />
        </div>

        {/* Divider */}
        <div className="mb-6 border-t border-stone-100 dark:border-stone-800" />

        {/* Additional languages toggle */}
        {!showAdditional ? (
          <div className="mb-6">
            <button
              onClick={() => setShowAdditional(true)}
              className="flex items-center gap-2 text-sm font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add translated subtitles in other languages
            </button>
            <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
              In addition to subtitles in the target language above, get translated subtitles at half credit cost per language.
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                Additional Languages
              </label>
              <button
                onClick={() => { setShowAdditional(false); setAdditionalLanguages([]); }}
                className="text-xs text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              >
                Remove
              </button>
            </div>

            {/* Info box */}
            <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-brand-50 px-4 py-3 dark:bg-brand-950">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <p className="text-xs text-brand-700 dark:text-brand-300">
                You will always receive subtitles in the target language above. These
                additional translations are generated on top of that, each at
                <span className="font-semibold"> half the credit cost</span> of the primary.
              </p>
            </div>

            {/* Tag input for additional languages */}
            <TagInput
              options={additionalOptions}
              selected={additionalLanguages}
              onChange={setAdditionalLanguages}
              placeholder="Search languages to add..."
            />

            {additionalLanguages.length > 0 && (
              <button
                onClick={() => setAdditionalLanguages([])}
                className="mt-3 text-xs text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
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
