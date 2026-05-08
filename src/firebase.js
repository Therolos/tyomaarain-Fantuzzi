import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAp--be3wfi0aRtAsL9d9SIzuQjd95_3o",
  authDomain: "fantuzzi-44e4a.firebaseapp.com",
  projectId: "fantuzzi-44e4a",
  storageBucket: "fantuzzi-44e4a.firebasestorage.app",
  messagingSenderId: "716941027916",
  appId: "1:716941027916:web:596711af0bf16aae34a2e9"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
