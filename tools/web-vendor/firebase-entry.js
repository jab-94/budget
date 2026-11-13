// Uniquement ce dont l'app a besoin : connexion e-mail/mot de passe et Firestore « lite »
// (requêtes simples, pas de connexion permanente). Pas d'Analytics, pas de Performance,
// pas de Messaging, pas de Remote Config.
export { initializeApp } from "firebase/app";
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "firebase/auth";
export {
  getFirestore, doc, getDoc, setDoc, deleteDoc, runTransaction, writeBatch, collection, getDocs,
} from "firebase/firestore/lite";
