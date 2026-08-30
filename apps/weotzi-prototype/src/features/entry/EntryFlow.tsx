import { useState } from 'react';
import { LandingScreen } from './LandingScreen.js';
import { VerifyScreen } from './VerifyScreen.js';
import { OnboardingScreen } from '../onboarding/OnboardingScreen.js';
import { SetupWizard, type SetupSavePayload } from '../onboarding/SetupWizard.js';

type EntryStage = 'landing' | 'verify' | 'onboarding' | 'setup';

export type EntryFlowProps = {
  onJoinWaitlist: (email: string) => void | Promise<void>;
  onVerify: (email: string, code: string) => void | Promise<void>;
  onSaveProfile: (patch: SetupSavePayload) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  initialEmail?: string;
  initialStage?: EntryStage;
};

export function EntryFlow({
  onJoinWaitlist,
  onVerify,
  onSaveProfile,
  onComplete,
  initialEmail = '',
  initialStage = 'landing',
}: EntryFlowProps) {
  const [stage, setStage] = useState<EntryStage>(initialStage);
  const [email, setEmail] = useState(initialEmail);

  if (stage === 'landing') {
    return (
      <LandingScreen
        initialEmail={email}
        onSubmit={async (nextEmail) => {
          await onJoinWaitlist(nextEmail);
          setEmail(nextEmail);
          setStage('verify');
        }}
      />
    );
  }

  if (stage === 'verify') {
    return (
      <VerifyScreen
        email={email}
        onBack={() => setStage('landing')}
        onVerify={async (code) => {
          await onVerify(email, code);
          setStage('onboarding');
        }}
      />
    );
  }

  if (stage === 'onboarding') {
    return <OnboardingScreen onComplete={() => setStage('setup')} />;
  }

  return (
    <SetupWizard
      initialDraft={{ email }}
      onBack={() => setStage('onboarding')}
      onSave={onSaveProfile}
      onComplete={async () => onComplete()}
    />
  );
}
