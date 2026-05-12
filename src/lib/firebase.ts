import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyByFURNHwqKQTfAU9XHvAfsNj3h6kY6_Cw",
  authDomain: "grupoalerta-9ddf1.firebaseapp.com",
  projectId: "grupoalerta-9ddf1",
  storageBucket: "grupoalerta-9ddf1.firebasestorage.app",
  messagingSenderId: "401717414390",
  appId: "1:401717414390:web:7502e0c37abc2880559fd7",
  measurementId: "G-4NGL8N7HTZ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export default app;
