import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Web config of the Firebase project shared with the mobile app (concursero-8cc5b).
// These values are public by design; access is controlled by Firebase Auth and
// the API's token verification, not by keeping them secret.
const firebaseApp = initializeApp({
  apiKey: 'AIzaSyDosjneXl6Xf_iSUOh95qtVjUDH3XCVOY0',
  // Our own domain proxies Firebase's /__/auth/ handler (munninlabs-site Worker), so
  // Google's account chooser says "continue to munninlabs.com". Requires
  // https://munninlabs.com/__/auth/handler as a redirect URI on the OAuth web client.
  authDomain: 'munninlabs.com',
  projectId: 'concursero-8cc5b',
  storageBucket: 'concursero-8cc5b.firebasestorage.app',
  messagingSenderId: '812235836087',
  appId: '1:812235836087:web:54e283b5b301ffdce99b32',
});

export const firebaseAuth = getAuth(firebaseApp);
