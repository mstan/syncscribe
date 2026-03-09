import { useState, useEffect, useCallback } from 'react';
import api from '../api';

/**
 * Fallback credit packs if the API is unavailable.
 */
const DEFAULT_PACKS = [
  { id: 'single', name: 'Single', minutes_amount: 120, price_cents: 499 },
  { id: 'season', name: 'Season', minutes_amount: 400, price_cents: 1299 },
  { id: 'studio', name: 'Studio', minutes_amount: 1500, price_cents: 3999 }
];

/**
 * Format cents to dollar string.
 */
function formatPrice(cents) {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
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

  // Promo code state
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState(null);
  const [promoSuccess, setPromoSuccess] = useState(null);

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
   * Handle promo code redemption.
   */
  const handleRedeemPromo = useCallback(async (e) => {
    e.preventDefault();
    if (!promoCode.trim()) return;

    setPromoLoading(true);
    setPromoError(null);
    setPromoSuccess(null);

    try {
      const { minutes_granted } = await api.redeemPromo(promoCode.trim());
      setPromoSuccess(`${minutes_granted} minutes added to your account!`);
      setPromoCode('');
    } catch (err) {
      setPromoError(err.body?.error || err.message || 'Failed to redeem promo code');
    } finally {
      setPromoLoading(false);
    }
  }, [promoCode]);

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
      <div className="relative w-full max-w-2xl rounded-2xl bg-white p-8 shadow-2xl dark:bg-gray-900 dark:ring-1 dark:ring-gray-700">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-8 text-center">
          <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
            Buy Credits
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Credits are based on minutes of audio processed. Choose a pack below.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
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
                      ? 'border-brand-500 bg-brand-50/50 shadow-md hover:shadow-lg dark:bg-brand-950/50'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600'
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
                  <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                    {pack.name}
                  </h3>

                  {/* Price */}
                  <div className="mb-3">
                    <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                      {formatPrice(pack.price_cents)}
                    </span>
                  </div>

                  {/* Minutes */}
                  <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {pack.minutes_amount.toLocaleString()} minutes
                  </div>

                  {/* Price per minute */}
                  <p className="text-xs text-gray-400 dark:text-gray-500">
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

        {/* Promo code section */}
        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
          {!promoOpen ? (
            <button
              onClick={() => setPromoOpen(true)}
              className="mx-auto block text-sm text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors hover:text-gray-700 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-gray-200"
            >
              Have a promo code?
            </button>
          ) : (
            <div>
              {promoSuccess && (
                <div className="mb-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-400">
                  {promoSuccess}
                </div>
              )}
              {promoError && (
                <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
                  {promoError}
                </div>
              )}
              <form onSubmit={handleRedeemPromo} className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  placeholder="Enter promo code"
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-brand-400 dark:focus:ring-brand-400"
                  disabled={promoLoading}
                />
                <button
                  type="submit"
                  disabled={promoLoading || !promoCode.trim()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-600"
                >
                  {promoLoading ? 'Redeeming...' : 'Redeem'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          Payments are processed securely through Stripe. Credits never expire.
        </p>
      </div>
    </div>
  );
}
