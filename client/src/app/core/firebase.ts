import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Web config of the Firebase project shared with the mobile app (concursero-8cc5b).
// These values are public by design; access is controlled by Firebase Auth and
// the API's token verification, not by keeping them secret.
// On concursero.com the Google sign-in screen should say "continue to concursero.com",
// so Firebase's /__/auth/* pages are served from our own domain (proxied by the Worker,
// server/src/worker.ts). That needs https://concursero.com/__/auth/handler as an authorized
// redirect URI of the OAuth web client in Google Cloud. Other hosts keep Firebase's domain.
const OWN_AUTH_HOSTS = ['concursero.com'];
const authDomain =
  typeof location !== 'undefined' && OWN_AUTH_HOSTS.includes(location.hostname) ? location.hostname : 'concursero-8cc5b.firebaseapp.com';

const firebaseApp = initializeApp({
  apiKey: 'AIzaSyDosjneXl6Xf_iSUOh95qtVjUDH3XCVOY0',
  authDomain,
  projectId: 'concursero-8cc5b',
  storageBucket: 'concursero-8cc5b.firebasestorage.app',
  messagingSenderId: '812235836087',
  appId: '1:812235836087:web:54e283b5b301ffdce99b32',
});

export const firebaseAuth = getAuth(firebaseApp);
