/**
 * Status display configuration.
 */
const STATUS_CONFIG = {
  awaiting_upload: {
    label: 'Uploading audio...',
    description: 'Your audio file is being uploaded to the server.',
    color: 'brand'
  },
  queued: {
    label: 'Waiting in queue...',
    description: 'Your job is queued and will start processing shortly.',
    color: 'brand'
  },
  running: {
    label: 'Generating subtitles...',
    description: 'AI is transcribing your audio. This usually takes a few minutes.',
    color: 'brand'
  },
  failed: {
    label: 'Generation failed',
    description: 'Something went wrong while processing your file.',
    color: 'red'
  }
};

/**
 * Animated spinner component.
 */
function Spinner() {
  return (
    <div className="relative h-16 w-16">
      {/* Outer ring */}
      <svg className="h-16 w-16 animate-spin-slow" viewBox="0 0 64 64" fill="none">
        <circle
          cx="32" cy="32" r="28"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="120 60"
          className="text-brand-200 dark:text-brand-800"
        />
      </svg>
      {/* Inner ring */}
      <svg className="absolute inset-0 h-16 w-16 animate-spin" viewBox="0 0 64 64" fill="none" style={{ animationDuration: '1.5s' }}>
        <circle
          cx="32" cy="32" r="20"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray="40 80"
          strokeLinecap="round"
          className="text-brand-600"
        />
      </svg>
    </div>
  );
}

/**
 * Pulsing dots animation for queue/waiting states.
 */
function PulsingDots() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2 w-2 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: '0ms' }} />
      <div className="h-2 w-2 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: '150ms' }} />
      <div className="h-2 w-2 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

/**
 * JobProgress -- displays the current status of a transcription job.
 * Shown while the job is being processed on the server.
 */
export default function JobProgress({ job, error, thumbnailUrl, onRetry }) {
  const status = job?.status || 'awaiting_upload';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  const isFailed = status === 'failed' || (!!error && status === 'awaiting_upload');

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
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          {isFailed ? 'Something Went Wrong' : 'Processing Your Video'}
        </h1>
      </div>

      {/* Status card */}
      <div className={`w-full max-w-lg rounded-2xl border bg-white p-8 shadow-sm dark:bg-gray-900 ${
        isFailed ? 'border-red-200 dark:border-red-900' : 'border-gray-200 dark:border-gray-700'
      }`}>
        <div className="flex flex-col items-center text-center">
          {/* Animated indicator */}
          {isFailed ? (
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
              <svg className="h-8 w-8 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
          ) : status === 'running' ? (
            <div className="mb-5">
              <Spinner />
            </div>
          ) : (
            <div className="mb-5">
              <PulsingDots />
            </div>
          )}

          {/* Status label */}
          <h2 className={`mb-2 text-lg font-semibold ${
            isFailed ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
          }`}>
            {config.label}
          </h2>

          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {config.description}
          </p>

          {/* Error details */}
          {isFailed && (error || job?.error_message) && (
            <div className="mb-6 w-full rounded-lg bg-red-50 px-4 py-3 text-left text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
              {error || job.error_message}
            </div>
          )}

          {/* Progress stages indicator (non-failed) */}
          {!isFailed && (
            <div className="mb-6 w-full">
              <div className="flex items-center justify-between">
                {['Upload', 'Queue', 'Transcribe', 'Done'].map((step, i) => {
                  const stepIndex = ['awaiting_upload', 'queued', 'running', 'succeeded'].indexOf(status);
                  const isComplete = i < stepIndex;
                  const isCurrent = i === stepIndex;

                  return (
                    <div key={step} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center">
                        <div className={`
                          flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors
                          ${isComplete
                            ? 'bg-brand-600 text-white'
                            : isCurrent
                              ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-600 dark:bg-brand-950 dark:text-brand-300'
                              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                          }
                        `}>
                          {isComplete ? (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            i + 1
                          )}
                        </div>
                        <span className={`mt-1 text-xs ${
                          isComplete || isCurrent ? 'text-gray-700 font-medium dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
                        }`}>
                          {step}
                        </span>
                      </div>
                      {i < 3 && (
                        <div className={`mx-1 h-0.5 flex-1 rounded-full ${
                          isComplete ? 'bg-brand-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Retry button (failed) */}
          {isFailed && (
            <button onClick={onRetry} className="btn-primary w-full">
              Try Again
            </button>
          )}

          {/* Privacy note (processing) */}
          {!isFailed && (
            <div className="w-full rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              Your audio is being processed securely. You can leave this page open -- we will show your results when ready.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
