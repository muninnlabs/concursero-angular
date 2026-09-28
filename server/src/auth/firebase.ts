import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthUser {
  uid: string;
  name: string;
  email: string;
}

/** Turns a bearer token into a user, or undefined when it isn't valid. */
export type TokenVerifier = (token: string) => Promise<AuthUser | undefined>;

// Google's public keys for Firebase ID tokens (rotated by Google; jose caches them).
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

/**
 * Verifies Firebase Authentication ID tokens for `projectId`, as described in
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
export function firebaseVerifier(projectId: string): TokenVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
        algorithms: ['RS256'],
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`,
      });
      if (!payload.sub) return undefined;
      const email = typeof payload.email === 'string' ? payload.email : '';
      const name = typeof payload.name === 'string' && payload.name ? payload.name : email.split('@')[0] || 'Estudante';
      return { uid: payload.sub, name, email };
    } catch {
      return undefined;
    }
  };
}
