export type NavigationDestination = 'home' | 'business' | 'profile';

export type Profile = {
  id: string;
  role: 'artist' | 'client';
  name: string;
  email: string;
  phone: string;
  city: string;
  bio: string;
  objectives: string[];
  styles: string[];
  avatarAsset: string;
  onboardingCompleted: boolean;
  updatedAt: string;
};

export type PortfolioItem = {
  id: string;
  profileId: string;
  title: string;
  artist: string;
  imageAsset: string;
  height: number;
  kind: 'work' | 'flash' | 'merch';
};

export type BookingInput = {
  kind: 'flash' | 'custom';
  customerName: string;
  email: string;
  phone: string;
  firstTattoo: boolean;
  placement: string;
  medicalNotes: string;
  preferredDate: string;
  preferredTime: string;
  references: string[];
};

export type Booking = BookingInput & {
  id: string;
  status: 'requested' | 'confirmed' | 'cancelled' | 'completed';
  createdAt: string;
};

export type Conversation = {
  id: string;
  bookingId: string | null;
  participantName: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  sender: 'user' | 'artist';
  body: string;
  createdAt: string;
};

export type BootstrapData = {
  profile: Profile;
  portfolio: PortfolioItem[];
  favorites: string[];
  bookings: Booking[];
  conversations: Conversation[];
};

