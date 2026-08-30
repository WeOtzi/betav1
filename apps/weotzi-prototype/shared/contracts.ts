import { z } from 'zod';

const optionalText = z.string().trim().max(500).optional();
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha válida').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}, 'Usa una fecha válida').refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const requested = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return requested >= today;
}, 'La fecha debe ser hoy o posterior');
const clockTime = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa una hora válida');

export const ProfilePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(500).optional(),
    email: z.string().trim().email().optional(),
    phone: optionalText,
    city: optionalText,
    bio: z.string().trim().max(2_000).optional(),
    objectives: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    styles: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    avatarAsset: z.string().trim().max(500).optional(),
    onboardingCompleted: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Incluye al menos un campo para actualizar');

export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export const BookingInputSchema = z
  .object({
    kind: z.enum(['flash', 'custom']),
    customerName: z.string().trim().min(1).max(120),
    email: z.string().trim().email(),
    phone: z.string().trim().min(1).max(60),
    firstTattoo: z.boolean(),
    placement: z.string().trim().min(1).max(200),
    medicalNotes: z.string().trim().min(1).max(2_000),
    preferredDate: isoDate,
    preferredTime: clockTime,
    references: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  })
  .superRefine((booking, context) => {
    if (booking.kind === 'custom' && booking.references.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'Agrega al menos una referencia',
      });
    }
  });

export type BookingInput = z.infer<typeof BookingInputSchema>;

export const MessageInputSchema = z.object({
  body: z.string().trim().min(1, 'Escribe un mensaje').max(2_000),
});

export type MessageInput = z.infer<typeof MessageInputSchema>;

export const WaitlistInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const VerifyInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/),
});
