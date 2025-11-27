import { db, generateId, now, User } from './database';

/**
 * Mock user data for Phase 1 (offline-first)
 * In Phase 3, this will be replaced with Supabase Auth
 */

const MOCK_USERS: User[] = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    role: 'admin',
    createdAt: now()
  },
  {
    id: 'user-2',
    email: 'user@example.com',
    role: 'user',
    createdAt: now()
  }
];

/**
 * Initialize mock users in database
 */
export async function initializeMockUsers(): Promise<void> {
  const count = await db.users.count();
  if (count === 0) {
    await db.users.bulkAdd(MOCK_USERS);
    console.log('Mock users initialized');
  }
}

/**
 * Mock login function (Phase 1)
 * Returns user if credentials are valid
 */
export async function login(email: string, password: string): Promise<User | null> {
  // For Phase 1, accept any password
  // Just check if email matches one of our mock users
  const user = MOCK_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (user) {
    // Store current user in metadata
    await db.metadata.put({ key: 'currentUser', value: user });
    console.log('User logged in:', user.email);
    return user;
  }

  return null;
}

/**
 * Get current logged-in user
 */
export async function getCurrentUser(): Promise<User | null> {
  const metadata = await db.metadata.get('currentUser');
  return metadata?.value || null;
}

/**
 * Check if user is admin
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
  await db.metadata.put({ key: 'currentUser', value: null });
  console.log('User logged out');
}

/**
 * Get all users (admin only)
 */
export async function getAllUsers(): Promise<User[]> {
  return await db.users.toArray();
}

/**
 * Create a new user (admin only, Phase 1 mock)
 */
export async function createUser(email: string, role: 'admin' | 'user'): Promise<User> {
  const user: User = {
    id: generateId(),
    email,
    role,
    createdAt: now()
  };

  await db.users.add(user);
  console.log('User created:', email);
  return user;
}

/**
 * Update user role (admin only)
 */
export async function updateUserRole(userId: string, role: 'admin' | 'user'): Promise<void> {
  await db.users.update(userId, { role });
  console.log('User role updated:', userId, role);
}

/**
 * Delete user (admin only)
 */
export async function deleteUser(userId: string): Promise<void> {
  await db.users.delete(userId);
  console.log('User deleted:', userId);
}
