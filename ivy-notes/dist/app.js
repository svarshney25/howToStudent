import { SAMPLE, demoReview, canResolve, highlightedParts } from './core.js';
import { firebaseConfig } from './config.js?v=20260924-4';

const configured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(key => Boolean(firebaseConfig[key]));
let firebaseApi;
async function getFirebaseApi() {
  if (!firebaseApi) firebaseApi = import('./firebase.js?v=20260924-8');
  return firebaseApi;
}

const $ = id => document.getElementById(id);
const STORAGE = 'ivy-notebooks-v1';
const DRAFT = 'ivy-current-v1';
const blank = () => ({ id: crypto.randomUUID(), title: '', notes: '', reference: '', original: '', reviewedNotes: '', revision: '', flags: [], reflections: {}, hints: {}, explanations: {}, cues: '', cornellNotes: '', summary: '', reviewMode: '', reviewed: false, updatedAt: new Date().toISOString() });
let notebook = blank();
let busy = false;
let persistTimer;
let step = 'capture';

function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function localBooks() { const value = JSON.parse(localStorage.getItem(STORAGE) || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local storage'); return value; }
function persist() {
  notebook.updatedAt = new Date().toISOString();
  try { const books = localBooks(); books[notebook.id] = notebook; localStorage.setItem(STORAGE, JSON.stringify(books)); localStorage.setItem(DRAFT, notebook.id); $('save-status').textContent = 'Draft saved in this browser'; return true; }
  catch { $('save-status').textContent = 'Local save failed — download your work'; return false; }
}
function schedulePersist() { clearTimeout(persistTimer); $('save-status').textContent = 'Saving draft…'; persistTimer = setTimeout(persist, 400); }
function loadFields() {
  for (const [id, key] of Object.entries({ title: 'title', notes: 'notes', reference: 'reference', revision: 'revision', cues: 'cues', 'cornell-notes': 'cornellNotes', summary: 'summary' })) $(id).value = notebook[key];
  $('char-count').textContent = `${notebook.notes.length.toLocaleString()} / 20,000`;
  renderReview();
}
function showStep(name) {
  step = name;
  for (const id of ['capture', 'review', 'cornell']) $(id).hidden = id !== name;
  for (const button of document.querySelectorAll('[data-step]')) {
    if (button.dataset.step === name) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  }
  if (name === 'review') renderReview();
}
function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function renderReview() {
  $('review-empty').hidden = notebook.reviewed;
  $('review-content').hidden = !notebook.reviewed;
  $('review-again').disabled = !notebook.reviewed || busy;
  $('flag-count').textContent = notebook.reviewed ? String(notebook.flags.length) : '';
  $('progress').textContent = `${notebook.flags.filter(f => f.resolved).length} / ${notebook.flags.length} reviewed`;
  $('review-caption').textContent = notebook.reviewMode === 'demo' ? 'Demo feedback · rule-based prompts, not a live AI review.' : 'AI suggestions can be incomplete or mistaken. Use your class material to check them.';
  $('original-caption').textContent = notebook.reviewedNotes === notebook.original ? 'Original version' : 'Your latest review snapshot';
  $('annotated').replaceChildren();
  for (const part of highlightedParts(notebook.reviewedNotes, notebook.flags)) $('annotated').append(el(part.id ? 'mark' : 'span', part.text));
  $('flags').replaceChildren();
  if (notebook.reviewed && notebook.flags.length === 0) $('flags').append(el('p', notebook.reviewMode === 'demo' ? 'No uncertainty markers found. Demo mode cannot check accuracy; connect Firebase for an AI review of gaps and possible misconceptions.' : 'Ivy found no specific points to flag. This does not verify that your notes are complete or correct. Try explaining the main idea from memory.', 'empty'));
  for (const flag of notebook.flags) renderFlag(flag);
}
function renderFlag(flag) {
  const card = el('article', null, `flag${flag.resolved ? ' resolved' : ''}`); card.id = flag.id;
  const top = el('div', null, 'flag-header');
  top.append(el('span', { confusion: 'Point of confusion', misconception: 'Possible misconception', gap: 'Missing connection', clarity: 'Clarity checkpoint' }[flag.kind], 'badge'));
  if (flag.resolved) top.append(el('span', 'Self-reviewed ✓', 'pill'));
  card.append(top, el('h3', flag.title), el('blockquote', flag.quote), el('p', flag.observation));
  const hint = el('details'); hint.open = Boolean(notebook.hints[flag.id]); hint.append(el('summary', '1. Give me a hint'), el('p', flag.hint));
  const explanation = el('details'); explanation.open = Boolean(notebook.explanations[flag.id]); explanation.hidden = !notebook.hints[flag.id]; explanation.append(el('summary', '2. Help me understand'), el('p', flag.explanation));
  if (flag.referenceQuote) explanation.append(el('p', 'From your class material:', 'muted'), el('blockquote', flag.referenceQuote));
  else explanation.append(el('p', 'No class-material citation. Check this guidance against your course.', 'muted small'));
  hint.addEventListener('toggle', () => { notebook.hints[flag.id] = hint.open; explanation.hidden = !hint.open; schedulePersist(); });
  explanation.addEventListener('toggle', () => { notebook.explanations[flag.id] = explanation.open; schedulePersist(); });
  const label = el('label', flag.question); label.htmlFor = `reflection-${flag.id}`;
  const reflection = el('textarea'); reflection.id = label.htmlFor; reflection.rows = 3; reflection.maxLength = 2000; reflection.placeholder = 'Explain your thinking in your own words…'; reflection.value = notebook.reflections[flag.id] || '';
  reflection.addEventListener('input', () => { notebook.reflections[flag.id] = reflection.value; schedulePersist(); });
  const resolve = el('button', flag.resolved ? 'Reopen this point' : 'I revised & checked this', 'secondary');
  resolve.addEventListener('click', () => {
    if (!flag.resolved && !canResolve(flag, notebook.revision, notebook.reviewedNotes, notebook.reflections[flag.id] || '')) { error('Make a change in your revision and write a self-check of at least 15 characters before marking this point reviewed.'); return; }
    flag.resolved = !flag.resolved; error(); persist(); renderReview();
  });
  card.append(hint, explanation, label, reflection, resolve, el('p', 'Self-reviewed records your work; it is not AI confirmation of correctness.', 'hint-note'));
  $('flags').append(card);
}
async function analyze(fromRevision = false) {
  if (busy) return;
  const source = fromRevision ? notebook.revision : notebook.notes;
  if (!source.trim()) { error('Add some notes first so Ivy has something to review.'); return; }
  if (notebook.reviewed && !fromRevision && !confirm('Start a fresh review from the notes in step 01? This resets the revision and feedback for this notebook. Your original notes are preserved.')) return;
  busy = true; error();
  const originalId = notebook.id;
  const reference = notebook.reference;
  const title = notebook.title;
  $('analyze').disabled = true; $('review-again').disabled = true; $('new-note').disabled = true; $('sample').disabled = true; $('saved-open').disabled = true;
  $('analyze').textContent = configured ? 'Ivy is reviewing…' : 'Reviewing…';
  $('review-again').textContent = 'Reviewing…';
  // Keep the exact snapshot stable while the request is in progress.
  for (const id of ['notes', 'reference', 'title', 'revision']) $(id).readOnly = true;
  try {
    const flags = configured ? await (await getFirebaseApi()).reviewWithAI(source, reference, title) : demoReview(source);
    if (notebook.id !== originalId) return;
    if (!notebook.reviewed) notebook.original = source;
    notebook.reviewedNotes = source; notebook.revision = source; notebook.flags = flags;
    notebook.reflections = {}; notebook.hints = {}; notebook.explanations = {};
    notebook.reviewMode = configured ? 'ai' : 'demo'; notebook.reviewed = true;
    $('revision').value = notebook.revision; persist(); showStep('review');
  } catch (e) { error(`Review failed: ${e.message}. Your notes have been kept.`); }
  finally {
    busy = false;
    for (const id of ['analyze', 'review-again', 'new-note', 'sample', 'saved-open']) $(id).disabled = false;
    for (const id of ['notes', 'reference', 'title', 'revision']) $(id).readOnly = false;
    $('analyze').textContent = 'Review my notes →'; $('review-again').textContent = 'Review my revision';
    $('review-again').disabled = !notebook.reviewed;
  }
}
async function save() {
  if (busy) return;
  error(); const localSaved = persist();
  if (!configured) { if (!localSaved) error('Your browser could not save this notebook. Download your notes to keep a copy.'); return; }
  const snapshot = JSON.parse(JSON.stringify(notebook));
  $('save').disabled = true; $('save-cornell').disabled = true;
  $('save-status').textContent = 'Saving to Firebase…';
  try { await (await getFirebaseApi()).saveNotebook(snapshot); if (snapshot.id === notebook.id) $('save-status').textContent = snapshot.updatedAt === notebook.updatedAt ? 'Saved to Firebase' : 'Snapshot saved to Firebase · newer edits are local'; }
  catch (e) { error(`Cloud save failed: ${e.message}. ${localSaved ? 'Your draft is still saved in this browser.' : 'Download your work to keep a copy.'}`); $('save-status').textContent = 'Cloud save failed'; }
  finally { $('save').disabled = false; $('save-cornell').disabled = false; }
}
function download(cornell = false) {
  const text = cornell ? `${notebook.title || 'Cornell notes'}\n\nCUES & QUESTIONS\n${notebook.cues}\n\nNOTES\n${notebook.cornellNotes}\n\nSUMMARY\n${notebook.summary}` : `${notebook.title || 'My notes'}\n\nMY REVISION\n${notebook.revision || notebook.notes}\n\nORIGINAL NOTES\n${notebook.original || notebook.notes}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = el('a'); link.href = url; link.download = `${cornell ? 'cornell' : 'ivy'}-notes.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function openSaved() {
  if (busy) return;
  clearTimeout(persistTimer); persist(); $('saved-dialog').showModal();
  $('notebook-list').replaceChildren(el('p', 'Loading notebooks…', 'muted'));
  let books;
  try { books = localBooks(); } catch { books = {}; }
  let cloudError;
  if (configured) {
    try { for (const book of await (await getFirebaseApi()).listNotebooks()) if (!books[book.id] || books[book.id].updatedAt < book.updatedAt) books[book.id] = book; }
    catch (e) { cloudError = e.message; }
  }
  $('notebook-list').replaceChildren();
  if (cloudError) $('notebook-list').append(el('p', `Could not load cloud notebooks: ${cloudError}. Showing local drafts.`, 'error'));
  const all = Object.values(books).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!all.length) $('notebook-list').append(el('p', 'No saved notebooks yet.', 'muted'));
  for (const book of all) {
    const row = el('div', null, 'saved-item'); const text = el('div', book.title || 'Untitled notebook'); text.append(el('small', new Date(book.updatedAt).toLocaleString()));
    const button = el('button', 'Open', 'secondary'); button.addEventListener('click', () => { if (busy) return; clearTimeout(persistTimer); persist(); notebook = { ...blank(), ...book }; loadFields(); persist(); showStep(notebook.reviewed ? 'review' : 'capture'); $('saved-dialog').close(); error(); });
    row.append(text, button); $('notebook-list').append(row);
  }
}
for (const [id, key] of Object.entries({ title: 'title', notes: 'notes', reference: 'reference', revision: 'revision', cues: 'cues', 'cornell-notes': 'cornellNotes', summary: 'summary' })) {
  $(id).addEventListener('input', event => { notebook[key] = event.target.value; if (id === 'notes') $('char-count').textContent = `${notebook.notes.length.toLocaleString()} / 20,000`; schedulePersist(); });
}
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => showStep(button.dataset.step)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('upload-paper').addEventListener('click', () => $('paper-upload').click());
$('paper-upload').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (file) $('save-status').textContent = `${file.name} selected · paper-note import coming soon`;
});
$('saved-open').addEventListener('click', openSaved);
$('analyze').addEventListener('click', () => analyze());
$('review-again').addEventListener('click', () => analyze(true));
for (const id of ['save', 'save-cornell']) $(id).addEventListener('click', save);
$('export').addEventListener('click', () => download()); $('export-cornell').addEventListener('click', () => download(true));
$('new-note').addEventListener('click', () => { if (busy) return; clearTimeout(persistTimer); if (!persist() && !confirm('This draft could not be saved. Start a new notebook anyway?')) return; notebook = blank(); loadFields(); showStep('capture'); error(); $('title').focus(); });
$('sample').addEventListener('click', () => { if (busy) return; clearTimeout(persistTimer); if (!persist() && !confirm('This draft could not be saved. Open the example anyway?')) return; notebook = blank(); notebook.title = 'Biology · Photosynthesis'; notebook.notes = SAMPLE; loadFields(); persist(); error(); });
window.addEventListener('pagehide', () => { clearTimeout(persistTimer); persist(); });
try { const id = localStorage.getItem(DRAFT); const saved = id && localBooks()[id]; if (saved) notebook = { ...blank(), ...saved }; }
catch { error('Your saved draft could not be loaded. Browser storage may be unavailable. You can still work and download your notes.'); }
if (configured) {
  $('mode-status').textContent = 'Firebase configured · drafts saved locally';
  $('analysis-note').textContent = 'Review sends these notes and any class material to Firebase AI Logic. Save notebook stores your work in your Firebase project.';
}
loadFields(); showStep(notebook.reviewed ? 'review' : step);
