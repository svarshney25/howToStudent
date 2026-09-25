# Ivy Notes

Ivy is a note-review prototype for How To Student. A student brings the notes they wrote; Ivy points to exact passages that may need another look, gives a hint, then an explanation, and asks the student to revise.

Ivy does not rewrite notes. The student remains responsible for the thinking, revision, and self-check.

## Use the app

Live site: https://how-to-student-214b8.web.app

Run locally:

```sh
cd /Users/shivikavarshney/Desktop/HowToStudent/ivy-notes
npm start
```

Open http://localhost:5173. If that port is busy, use `PORT=5174 npm start` and open http://localhost:5174.

Choose **Try example notes**, then **Review my notes**. The **Add paper notes** button is currently a placeholder: it opens a file picker and shows the filename, but does not yet upload or OCR paper notes.

## Demo mode vs. live mode

Demo mode works without Firebase. It saves in the current browser, detects markers such as `?`, `idk`, `I don't know`, `confused`, and `unclear`, detects clarity statements such as `I get it`, and provides fixed sample feedback. It does not call AI or verify arbitrary facts.

Live mode uses Firebase Authentication, Firestore, App Check, and Firebase AI Logic. It sends notes and optional class material to Gemini and returns structured, passage-specific prompts. Original notes remain available, revisions are separate, and AI text is never inserted into the revision or Cornell template. AI suggestions can still be wrong; check them against class material.


