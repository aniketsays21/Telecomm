'use client';

import { useState } from 'react';
import type { OnboardingData, AgentAvailability } from '@/lib/api';
import { EmailStep } from './EmailStep';
import { SourcesStep } from './SourcesStep';
import { WidgetStep } from './WidgetStep';
import { TeamStep } from './TeamStep';

// New order: connect email FIRST (Gmail OAuth), then knowledge base, then
// install the widget, and finally set up the team + their working hours —
// the "when are you available" question makes more sense once the workspace
// actually has agents.
type Step = 'email' | 'sources' | 'widget' | 'team';

const STEPS: { id: Step; label: string; description: string }[] = [
  { id: 'email',   label: 'Connect email', description: 'Sign in with Google so support emails route in' },
  { id: 'sources', label: 'Add knowledge', description: 'Help docs, website, or files for the AI' },
  { id: 'widget',  label: 'Install widget', description: 'Paste one script tag on your site' },
  { id: 'team',    label: 'Invite your team', description: 'Add agents and their working hours' },
];

type Props = {
  initialData: OnboardingData;
  workspaceName: string;
  initialAvailability: AgentAvailability | null;
  initialGmailAddress: string | null;
};

export function OnboardingWizard({
  initialData,
  workspaceName,
  initialAvailability,
  initialGmailAddress,
}: Props) {
  // The email step is done as soon as Gmail is connected; the API flag lags
  // because the OAuth callback lands on gmail routes, not onboarding.
  const emailDone = !!initialGmailAddress || !!initialData.onboardingState.emailConnected;
  const firstIncomplete = (): Step => {
    if (!emailDone) return 'email';
    if (!initialData.onboardingState.sourcesConnected) return 'sources';
    if (!initialData.onboardingState.widgetInstalled) return 'widget';
    return 'team';
  };

  const [currentStep, setCurrentStep] = useState<Step>(firstIncomplete);
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(() => {
    const s = new Set<Step>();
    if (emailDone) s.add('email');
    if (initialData.onboardingState.sourcesConnected) s.add('sources');
    if (initialData.onboardingState.widgetInstalled) s.add('widget');
    return s;
  });
  const [sources, setSources] = useState(initialData.sources);

  function markDone(step: Step) {
    setCompletedSteps(prev => new Set([...prev, step]));
  }

  function advance(from: Step) {
    markDone(from);
    if (from === 'email') setCurrentStep('sources');
    else if (from === 'sources') setCurrentStep('widget');
    else if (from === 'widget') setCurrentStep('team');
  }

  return (
    <div>
      {/* Step progress */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((step, i) => {
          const done = completedSteps.has(step.id);
          const active = step.id === currentStep;
          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <button
                onClick={() => setCurrentStep(step.id)}
                className="flex flex-col items-center group"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  done ? 'bg-indigo-600 text-white' :
                  active ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-xs mt-1 font-medium hidden sm:block ${
                  active ? 'text-indigo-700' : done ? 'text-gray-700' : 'text-gray-400'
                }`}>{step.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 ${done ? 'bg-indigo-400' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {currentStep === 'email' && (
          <EmailStep onDone={() => advance('email')} initiallyConnectedAs={initialGmailAddress} />
        )}
        {currentStep === 'sources' && (
          <SourcesStep
            sources={sources}
            onSourceAdded={(src) => setSources(prev => [...prev, src])}
            onSourceRemoved={(id) => setSources(prev => prev.filter(s => s.id !== id))}
            onDone={() => advance('sources')}
          />
        )}
        {currentStep === 'widget' && (
          <WidgetStep
            snippet={initialData.widgetSnippet}
            workspaceName={workspaceName}
            onDone={() => advance('widget')}
          />
        )}
        {currentStep === 'team' && (
          <TeamStep initialAvailability={initialAvailability} />
        )}
      </div>

      {/* Skip link — only for steps before the final one */}
      {currentStep !== 'team' && (
        <div className="text-center mt-4">
          <button
            onClick={() => advance(currentStep)}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Skip this step →
          </button>
        </div>
      )}
    </div>
  );
}
