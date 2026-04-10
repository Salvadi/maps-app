/**
 * Validation utilities for authentication
 */

export interface PasswordStrength {
  isValid: boolean;
  score: number; // 0-4
  feedback: string[];
}

/**
 * Validate password strength
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  // Check length
  if (password.length < 8) {
    feedback.push('Password must be at least 8 characters');
  } else {
    score++;
    if (password.length >= 12) score++;
  }

  // Check for uppercase
  if (!/[A-Z]/.test(password)) {
    feedback.push('Include at least one uppercase letter');
  } else {
    score++;
  }

  // Check for lowercase
  if (!/[a-z]/.test(password)) {
    feedback.push('Include at least one lowercase letter');
  } else {
    score++;
  }

  // Check for numbers
  if (!/[0-9]/.test(password)) {
    feedback.push('Include at least one number');
  } else {
    score++;
  }

  // Check for special characters
  // eslint-disable-next-line no-useless-escape
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    feedback.push('Include at least one special character (!@#$%^&*...)');
  } else {
    score++;
  }

  // Check for common patterns
  if (/^(.)\1+$/.test(password)) {
    feedback.push('Avoid repeating the same character');
    score = Math.max(0, score - 2);
  }

  if (/^(123|abc|password|qwerty)/i.test(password)) {
    feedback.push('Avoid common patterns');
    score = Math.max(0, score - 2);
  }

  const isValid = feedback.length === 0 && score >= 5;

  return {
    isValid,
    score: Math.min(4, score),
    feedback
  };
}

/**
 * Get password strength label
 */
export function getPasswordStrengthLabel(score: number): string {
  switch (score) {
    case 0:
    case 1:
      return 'Weak';
    case 2:
      return 'Fair';
    case 3:
      return 'Good';
    case 4:
      return 'Strong';
    default:
      return 'Weak';
  }
}

/**
 * Get password strength color
 */
export function getPasswordStrengthColor(score: number): string {
  switch (score) {
    case 0:
    case 1:
      return '#f44336'; // Red
    case 2:
      return '#ff9800'; // Orange
    case 3:
      return '#4caf50'; // Green
    case 4:
      return '#2e7d32'; // Dark green
    default:
      return '#f44336';
  }
}

/**
 * Validate email domain
 * Must be @opifiresafe.com
 */
export function validateEmailDomain(email: string): boolean {
  const emailRegex = /^[^\s@]+@opifiresafe\.com$/i;
  return emailRegex.test(email);
}

/**
 * Validate username
 * Requirements:
 * - 3-20 characters
 * - Alphanumeric and underscores only
 * - Must start with a letter
 */
export function validateUsername(username: string): { isValid: boolean; error?: string } {
  if (!username || username.length < 3) {
    return { isValid: false, error: 'Username must be at least 3 characters' };
  }

  if (username.length > 20) {
    return { isValid: false, error: 'Username must be 20 characters or less' };
  }

  if (!/^[a-zA-Z]/.test(username)) {
    return { isValid: false, error: 'Username must start with a letter' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { isValid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  return { isValid: true };
}

/**
 * Validate email format
 */
export function validateEmail(email: string): { isValid: boolean; error?: string } {
  if (!email) {
    return { isValid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Invalid email format' };
  }

  if (!validateEmailDomain(email)) {
    return { isValid: false, error: 'Email must be from @opifiresafe.com domain' };
  }

  return { isValid: true };
}

/**
 * Validate file content by checking magic bytes (file signature).
 * Prevents uploading disguised files (e.g. executable renamed to .jpg).
 */
export async function validateFileSignature(file: File): Promise<{ valid: boolean; detectedType: string }> {
  const buffer = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return { valid: true, detectedType: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return { valid: true, detectedType: 'image/png' };
  }

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { valid: true, detectedType: 'image/webp' };
  }

  // PDF: 25 50 44 46 (%PDF)
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { valid: true, detectedType: 'application/pdf' };
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { valid: true, detectedType: 'image/gif' };
  }

  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
    return { valid: true, detectedType: 'image/bmp' };
  }

  return { valid: false, detectedType: 'unknown' };
}
