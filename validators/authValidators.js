'use strict';

const { z, requiredText } = require('./common');

const email = z.string({ error: 'Email is required.' }).trim().toLowerCase().max(254, 'Email is too long.').pipe(z.email('Enter a valid email address.'));

const registerSchema = z
  .object({
    name: requiredText(80, 'Name'),
    email,
    password: z.string({ error: 'Password is required.' })
      .min(8, 'Password must be at least 8 characters.')
      .max(72, 'Password must be at most 72 characters.')
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number.'),
    confirmPassword: z.string({ error: 'Please confirm your password.' }),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(200),
});

const settingsSchema = z.object({
  name: requiredText(80, 'Name'),
  defaultTaskView: z.enum(['list', 'kanban']),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: z.string().min(8, 'Password must be at least 8 characters.').max(72)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number.'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

module.exports = { registerSchema, loginSchema, settingsSchema, passwordSchema };
