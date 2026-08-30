export const SETUP_STEP_COUNT = 5;

export type SetupStep = 0 | 1 | 2 | 3 | 4;

export type SetupDraft = {
  step: SetupStep;
  objectives: string[];
  name: string;
  email: string;
  phone: string;
  bio: string;
  city: string;
  styles: string[];
  avatarAsset: string;
  onboardingCompleted: boolean;
};

export const initialSetupDraft: SetupDraft = {
  step: 0,
  objectives: [],
  name: '',
  email: '',
  phone: '',
  bio: '',
  city: '',
  styles: [],
  avatarAsset: '',
  onboardingCompleted: false,
};

export type SetupAction =
  | { type: 'go-to'; step: SetupStep }
  | { type: 'toggle-objective'; objective: string }
  | { type: 'set-profile'; field: 'name' | 'email' | 'phone' | 'bio'; value: string }
  | { type: 'set-city'; city: string }
  | { type: 'toggle-style'; style: string }
  | { type: 'set-avatar'; avatarAsset: string }
  | { type: 'complete' };

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function reduceSetup(state: SetupDraft, action: SetupAction): SetupDraft {
  switch (action.type) {
    case 'go-to':
      return { ...state, step: action.step };
    case 'toggle-objective':
      return { ...state, objectives: toggleValue(state.objectives, action.objective) };
    case 'set-profile':
      return { ...state, [action.field]: action.value };
    case 'set-city':
      return { ...state, city: action.city };
    case 'toggle-style':
      return { ...state, styles: toggleValue(state.styles, action.style) };
    case 'set-avatar':
      return { ...state, avatarAsset: action.avatarAsset };
    case 'complete':
      return { ...state, onboardingCompleted: true };
  }
}

export type SetupErrors = Partial<Record<'objectives' | 'name' | 'city' | 'styles' | 'avatarAsset', string>>;

export function validateSetupStep(draft: SetupDraft, step: SetupStep): SetupErrors {
  switch (step) {
    case 0:
      return draft.objectives.length > 0 ? {} : { objectives: 'Elige al menos un objetivo' };
    case 1:
      return draft.name.trim() ? {} : { name: 'Escribe tu nombre' };
    case 2:
      return draft.city.trim() ? {} : { city: 'Escribe tu ciudad' };
    case 3:
      return draft.styles.length > 0 ? {} : { styles: 'Elige al menos un estilo' };
    case 4:
      return draft.avatarAsset ? {} : { avatarAsset: 'Elige una foto para continuar' };
  }
}
