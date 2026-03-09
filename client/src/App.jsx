import { useState, useCallback, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import useAuth from './hooks/useAuth';
import useCredits from './hooks/useCredits';
import useJob from './hooks/useJob';
import AppShell from './components/AppShell';
import UploadDropzone from './components/UploadDropzone';
import LanguageSelector from './components/LanguageSelector';
import CostBreakdown from './components/CostBreakdown';
import JobProgress from './components/JobProgress';
import ResultPanel from './components/ResultPanel';
import AuthGate from './components/AuthGate';
import BuyCreditsModal from './components/BuyCreditsModal';

/**
 * Application view states for the main workflow.
 */
const VIEW = {
  UPLOAD: 'upload',
  LANGUAGE: 'language',
  COST: 'cost',
  PROGRESS: 'progress',
  RESULT: 'result'
};

function MainPage() {
  const auth = useAuth();
  const credits = useCredits(auth.isAuthenticated);
  const jobHook = useJob();

  const [view, setView] = useState(VIEW.UPLOAD);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  // Data passed between workflow steps
  const [audioData, setAudioData] = useState(null); // { buffer, sha256, seconds, fileName, trackIndex? }
  const [languageConfig, setLanguageConfig] = useState(null); // { language, additional_languages }

  /**
   * Called when user tries to upload without being signed in.
   */
  const handleAuthRequired = useCallback(() => {
    setShowAuthGate(true);
  }, []);

  /**
   * Called after audio extraction completes.
   * Moves to language selection step.
   */
  const handleAudioExtracted = useCallback((data) => {
    setAudioData(data);
    setView(VIEW.LANGUAGE);
  }, []);

  /**
   * Called after language selection is confirmed.
   * Moves to cost breakdown step.
   */
  const handleLanguageSelected = useCallback((config) => {
    setLanguageConfig(config);
    setView(VIEW.COST);
  }, []);

  /**
   * Called when user goes back from language selection to upload.
   */
  const handleBackToUpload = useCallback(() => {
    setAudioData(null);
    setLanguageConfig(null);
    setView(VIEW.UPLOAD);
  }, []);

  /**
   * Called when user goes back from cost to language selection.
   */
  const handleBackToLanguage = useCallback(() => {
    setLanguageConfig(null);
    setView(VIEW.LANGUAGE);
  }, []);

  /**
   * Called when user confirms job creation from cost breakdown.
   * Creates the job, uploads audio, enqueues, and starts polling.
   */
  const handleConfirmJob = useCallback(async () => {
    if (!audioData || !languageConfig) return;

    try {
      const { job } = await jobHook.createJob({
        audio_sha256: audioData.sha256,
        audio_seconds: audioData.seconds,
        language: languageConfig.language,
        additional_languages: languageConfig.additional_languages
      });

      setView(VIEW.PROGRESS);

      // Upload audio to server (which proxies to R2)
      const { default: api } = await import('./api');
      await api.uploadAudio(job.id, audioData.buffer);

      // Enqueue the job
      await api.enqueueJob(job.id);

      // Start polling for status
      jobHook.pollStatus(job.id);
    } catch (err) {
      console.error('Job submission failed:', err);
      if (jobHook.job) {
        // Job was created but upload/enqueue failed — show error in progress view
        jobHook.setError(err.message || 'Upload failed. Please try again.');
        setView(VIEW.PROGRESS);
      } else {
        // Job creation itself failed — go back to cost view
        setView(VIEW.COST);
      }
    }
  }, [audioData, languageConfig, jobHook]);

  /**
   * Called when user wants to start over.
   */
  const handleReset = useCallback(() => {
    jobHook.reset();
    setAudioData(null);
    setLanguageConfig(null);
    setView(VIEW.UPLOAD);
  }, [jobHook]);

  /**
   * Called after successful auth from the auth gate modal.
   */
  const handleAuthSuccess = useCallback(() => {
    setShowAuthGate(false);
    credits.refresh();
  }, [credits.refresh]);

  /**
   * Determine when to show the result panel.
   */
  const showResult = view === VIEW.PROGRESS && jobHook.job?.status === 'succeeded';

  // Refresh credits when job completes (credits were debited server-side)
  useEffect(() => {
    if (jobHook.job?.status === 'succeeded' || jobHook.job?.status === 'failed') {
      credits.refresh();
    }
  }, [jobHook.job?.status, credits.refresh]);

  return (
    <AppShell
      auth={auth}
      credits={credits}
      onBuyCredits={() => setShowBuyCredits(true)}
      onSignIn={() => setShowAuthGate(true)}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        {/* Upload / Idle state */}
        {view === VIEW.UPLOAD && (
          <UploadDropzone
            isAuthenticated={auth.isAuthenticated}
            onAuthRequired={handleAuthRequired}
            onAudioExtracted={handleAudioExtracted}
          />
        )}

        {/* Language selection after extraction */}
        {view === VIEW.LANGUAGE && audioData && (
          <LanguageSelector
            fileName={audioData.fileName}
            detectedLanguage={audioData.trackLanguage}
            thumbnailUrl={audioData.thumbnailUrl}
            onConfirm={handleLanguageSelected}
            onBack={handleBackToUpload}
          />
        )}

        {/* Cost breakdown before job creation */}
        {view === VIEW.COST && audioData && languageConfig && (
          <CostBreakdown
            audioSeconds={audioData.seconds}
            language={languageConfig.language}
            additionalLanguages={languageConfig.additional_languages}
            balance={credits.balance}
            thumbnailUrl={audioData.thumbnailUrl}
            onConfirm={handleConfirmJob}
            onBack={handleBackToLanguage}
            onBuyCredits={() => setShowBuyCredits(true)}
          />
        )}

        {/* Job in progress */}
        {view === VIEW.PROGRESS && !showResult && (
          <JobProgress
            job={jobHook.job}
            error={jobHook.error}
            thumbnailUrl={audioData?.thumbnailUrl}
            onRetry={handleReset}
          />
        )}

        {/* Job complete -- show results */}
        {showResult && (
          <ResultPanel
            job={jobHook.job}
            onReset={handleReset}
            fileName={audioData?.fileName}
            thumbnailUrl={audioData?.thumbnailUrl}
            file={audioData?.file}
          />
        )}
      </div>

      {/* Auth gate modal */}
      {showAuthGate && (
        <AuthGate
          onSuccess={handleAuthSuccess}
          onClose={() => setShowAuthGate(false)}
          login={auth.login}
        />
      )}

      {/* Buy credits modal */}
      {showBuyCredits && (
        <BuyCreditsModal
          onClose={() => {
            setShowBuyCredits(false);
            credits.refresh();
          }}
        />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<MainPage />} />
    </Routes>
  );
}
