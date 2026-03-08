import { useState, useEffect, useCallback } from 'react';
import api from '../api';

/**
 * Fallback credit packs if the API is unavailable.
 */
const DEFAULT_PACKS = [
  { id: 'starter', name: 'Starter', minutes_amount: 150, price_cents: 500 },
  { id: 'standard', name: 'Standard', minutes_amount: 600, price_cents: 1500 },
  { id: 'large', name: 'Large', minutes_amount: 2000, price_cents: 4000 }
];

/**
 * Format cents to dollar string.
 */
function formatPrice(cents) {
  return `$${(cents / 100).toFixed(0)}`;
}

/**
 * Compute price per minute.
 */
function pricePerMinute(cents, minutes) {
  return (cents / minutes).toFixed(1);
}

/**
 * BuyCreditsModal -- displays available credit packs for purchase.
 * On selection, redirects to Stripe Checkout.
 */
export default function BuyCreditsModal({ onClose }) {
  const [packs, setPacks] = useState(DEFAULT_PACKS);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [error, setError] = useState(null);

  /**
   * Fetch credit packs from API on mount.
   */
  useEffect(() => {
    let cancelled = false;

    api.getCreditPacks()
      .then(data => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setPacks(data);
        }
      })
      .catch(() => {
        // Use default packs on error
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  /**
   * Handle pack selection -- create a Stripe Checkout session and redirect.
   */
  const handlePurchase = useCallback(async (packId) => {
    setPurchasing(packId);
    setError(null);

    try {
      const { url } = await api.getCheckoutUrl(packId);
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      setError(err.message || 'Failed to start checkout. Please try again.');
      setPurchasing(null);
    }
  }, []);

  /**
   * Determine the "best value" pack (lowest price per minute).
   */
  const bestValueId = packs.reduce((best, pack) => {
    if (!best) return pack;
    return (pack.price_cents / pack.minutes_amount) < (best.price_cents / best.minutes_amount)
      ? pack
      : best;
  }, null)?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl rounded-2xl bg-white p-8 shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-8 text-center">
          <h2 className="mb-2 text-xl font-bold text-gray-900">
            Buy Credits
          </h2>
          <p className="text-sm text-gray-500">
            Credits are based on minutes of audio processed. Choose a pack below.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Pack cards */}
        {loading ? (
          <div className="flex justify-center py-12">
            <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {packs.map(pack => {
              const isBestValue = pack.id === bestValueId;
              const isLoading = purchasing === pack.id;

              return (
                <button
                  key={pack.id}
                  onClick={() => handlePurchase(pack.id)}
                  disabled={purchasing !== null}
                  className={`
                    relative flex flex-col items-center rounded-xl border-2 p-6 text-center
                    transition-all duration-200
                    ${isBestValue
                      ? 'border-brand-500 bg-brand-50/50 shadow-md hover:shadow-lg'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
                    }
                    ${purchasing !== null && !isLoading ? 'opacity-50' : ''}
                    disabled:cursor-not-allowed
                  `}
                >
                  {/* Best value badge */}
                  {isBestValue && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                        Best Value
                      </span>
                    </div>
                  )}

                  {/* Pack name */}
                  <h3 className="mb-1 text-base font-semibold text-gray-900">
                    {pack.name}
                  </h3>

                  {/* Price */}
                  <div className="mb-3">
                    <span className="text-3xl font-bold text-gray-900">
                      {formatPrice(pack.price_cents)}
                    </span>
                  </div>

                  {/* Minutes */}
                  <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                    <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {pack.minutes_amount.toLocaleString()} minutes
                  </div>

                  {/* Price per minute */}
                  <p className="text-xs text-gray-400">
                    {pricePerMinute(pack.price_cents, pack.minutes_amount)}&cent; / min
                  </p>

                  {/* Loading spinner */}
                  {isLoading && (
                    <div className="mt-3">
                      <svg className="h-5 w-5 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-gray-400">
          Payments are processed securely through Stripe. Credits never expire.
        </p>
      </div>
    </div>
  );
}
