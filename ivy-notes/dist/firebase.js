import { firebaseConfig, aiModel, recaptchaEnterpriseSiteKey, localAppCheckDebug } from './config.js?v=20260924-5';
import { SYSTEM_INSTRUCTION, validateFlags, MAX_NOTES } from './core.js';

export const configured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(k => Boolean(firebaseConfig[k]));
let connection;
export async function connect() {
  if (!configured) throw new Error('Firebase is not configured yet. Follow the project README.');
  if (!connection) connection = initialize().catch(error => { connection = null; throw error; });
  return connection;
}
async function initialize() {
  const [appSDK, authSDK, dbSDK, aiSDK, checkSDK] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js'),
  ]);
  const app = appSDK.getApps()[0] || appSDK.initializeApp(firebaseConfig);
  if (recaptchaEnterpriseSiteKey) {
    if (localAppCheckDebug && ['localhost', '127.0.0.1'].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    try { checkSDK.initializeAppCheck(app, { provider: new checkSDK.ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey), isTokenAutoRefreshEnabled: true }); }
    catch (error) { if (error.code !== 'appCheck/already-initialized') throw error; }
  }
  const auth = authSDK.getAuth(app);
  await auth.authStateReady();
  const user = auth.currentUser || (await authSDK.signInAnonymously(auth)).user;
  const db = dbSDK.getFirestore(app);
  const S = aiSDK.Schema;
  const ai = aiSDK.getAI(app, { backend: new aiSDK.GoogleAIBackend() });
  const generationConfig = { temperature: 0.3, maxOutputTokens: 6000, responseMimeType: 'application/json', responseSchema: S.object({ properties: {
      flags: S.array({ items: S.object({ properties: {
        kind: S.enumString({ enum: ['confusion', 'misconception', 'gap', 'clarity'] }), quote: S.string(), title: S.string(), observation: S.string(), hint: S.string(), explanation: S.string(), question: S.string(), referenceQuote: S.string()
      } }) })
    } }) };
  const model = aiSDK.getGenerativeModel(ai, { model: aiModel, systemInstruction: SYSTEM_INSTRUCTION, generationConfig });
  // Keep a stable, lower-demand fallback for temporary capacity errors on the newest model.
  const fallbackModel = aiModel === 'gemini-3.5-flash-lite' ? null : aiSDK.getGenerativeModel(ai, { model: 'gemini-3.5-flash-lite', systemInstruction: SYSTEM_INSTRUCTION, generationConfig });
  return { user, db, dbSDK, model, fallbackModel };
}
export async function reviewWithAI(notes, reference, title) {
  if (!notes.trim() || notes.length > MAX_NOTES || reference.length > MAX_NOTES) throw new Error('Keep notes and class material under 20,000 characters each.');
  const { model, fallbackModel } = await connect();
  const prompt = JSON.stringify({ task: 'Review these notes using the system rules.', title, studentNotes: notes, classMaterial: reference });
  let result;
  try { result = await model.generateContent(prompt); }
  catch (error) {
    const temporaryCapacityError = /high demand|fetch-error|\b500\b/i.test(error?.message || '');
    if (!fallbackModel || !temporaryCapacityError) throw error;
    result = await fallbackModel.generateContent(prompt);
  }
  let parsed;
  try { parsed = JSON.parse(result.response.text()); } catch { throw new Error('Ivy could not complete a structured review. Please try again.'); }
  return validateFlags(parsed, notes, reference);
}
export async function saveNotebook(notebook) {
  const { user, db, dbSDK: sdk } = await connect();
  await sdk.setDoc(sdk.doc(db, 'users', user.uid, 'notebooks', notebook.id), { payload: JSON.stringify(notebook), updatedAt: sdk.serverTimestamp() });
}
export async function listNotebooks() {
  const { user, db, dbSDK: sdk } = await connect();
  const snapshot = await sdk.getDocs(sdk.query(sdk.collection(db, 'users', user.uid, 'notebooks'), sdk.orderBy('updatedAt', 'desc'), sdk.limit(30)));
  return snapshot.docs.map(doc => JSON.parse(doc.data().payload));
}
