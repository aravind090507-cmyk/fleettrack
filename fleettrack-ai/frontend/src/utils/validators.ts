export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

export function isValidPassword(password: string): {
  isValid: boolean;
  message?: string;
} {
  if (!password || password.length < 6) {
    return {
      isValid: false,
      message: 'Password must be at least 6 characters long',
    };
  }
  return { isValid: true };
}

export function isValidRegistration(reg: string): boolean {
  return reg.trim().length >= 3;
}

export function isValidCoordinate(lat?: number | null, lng?: number | null): boolean {
  if (lat === undefined || lat === null || lng === undefined || lng === null) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function isValidRadius(radius?: number | null): boolean {
  if (radius === undefined || radius === null) return false;
  return radius > 0 && radius <= 100000;
}
