import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Web config of the Firebase project shared with the mobile app (concursero-8cc5b).
// These values are public by design; access is controlled by Firebase Auth and
// the API's token verification, not by keeping them secret.
const firebaseApp = initializeApp({
  apiKey: 'AIzaSyDosjneXl6Xf_iSUOh95qtVjUDH3XCVOY0',
  authDomain: 'concursero-8cc5b.firebaseapp.com',
  projectId: 'concursero-8cc5b',
  storageBucket: 'concursero-8cc5b.firebasestorage.app',
  messagingSenderId: '812235836087',
  appId: '1:812235836087:web:54e283b5b301ffdce99b32',
});

export const firebaseAuth = getAuth(firebaseApp);
