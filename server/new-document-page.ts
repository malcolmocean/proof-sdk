/**
 * Browser-facing "create a document" page.
 *
 * The SDK otherwise only exposes creation over the API (POST /documents), so
 * there is no way to start a blind review from a browser. This page is the
 * missing entry point: it collects a title, the document text, and the blind
 * review toggle, then hands the creator an owner-tokenized link so the reveal
 * switch is available to them from the moment the document exists.
 */

import { Router } from 'express';

export const newDocumentRoutes = Router();

const NEW_DOCUMENT_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New document | Proof</title>
    <style>
      :root { color-scheme: light; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        margin: 0;
        padding: 48px 24px;
        color: #17261d;
        background: #f7faf5;
      }
      main { max-width: 680px; margin: 0 auto; }
      h1 { font-size: 2rem; margin: 0 0 0.35rem; }
      p.lede { margin: 0 0 2rem; color: #4a5c51; line-height: 1.5; }
      label { display: block; font-weight: 600; margin: 0 0 0.4rem; }
      input[type="text"], textarea {
        width: 100%;
        box-sizing: border-box;
        font: inherit;
        padding: 0.6rem 0.7rem;
        border: 1px solid #cfdcc9;
        border-radius: 8px;
        background: #fff;
        color: inherit;
      }
      textarea { min-height: 260px; resize: vertical; line-height: 1.5; }
      input[type="text"]:focus, textarea:focus { outline: 2px solid #266854; outline-offset: 1px; }
      .field { margin-bottom: 1.5rem; }
      .check {
        display: flex;
        gap: 0.65rem;
        align-items: flex-start;
        background: #eaf2e6;
        border-radius: 10px;
        padding: 0.9rem 1rem;
        margin-bottom: 1.75rem;
      }
      .check input { margin-top: 0.2rem; }
      .check label { font-weight: 600; margin: 0 0 0.15rem; }
      .check small { color: #4a5c51; line-height: 1.45; display: block; }
      button {
        font: inherit;
        font-weight: 600;
        color: #fff;
        background: #17261d;
        border: 0;
        border-radius: 999px;
        padding: 0.7rem 1.6rem;
        cursor: pointer;
      }
      button:disabled { opacity: 0.55; cursor: progress; }
      .error {
        display: none;
        margin-top: 1rem;
        color: #8c2f1d;
        background: #fbeae6;
        border-radius: 8px;
        padding: 0.7rem 0.9rem;
      }
      footer { margin-top: 2.5rem; color: #6b7d72; font-size: 0.9rem; }
      footer a { color: #266854; }
    </style>
  </head>
  <body>
    <main>
      <h1>New document</h1>
      <p class="lede">Paste what you want feedback on. You'll get an owner link for yourself and a share link to send reviewers.</p>

      <form id="create-form">
        <div class="field">
          <label for="title">Title</label>
          <input type="text" id="title" name="title" placeholder="Untitled document" autocomplete="off" />
        </div>

        <div class="field">
          <label for="markdown">Document text (markdown)</label>
          <textarea id="markdown" name="markdown" required placeholder="# Heading&#10;&#10;Your draft goes here."></textarea>
        </div>

        <div class="check">
          <input type="checkbox" id="blindMode" name="blindMode" checked />
          <div>
            <label for="blindMode">Blind review</label>
            <small>Reviewers only see their own comments until you reveal them. You see everything as you go.</small>
          </div>
        </div>

        <button type="submit" id="submit">Create document</button>
        <div class="error" id="error"></div>
      </form>

      <footer>Building on Proof SDK — <a href="/agent-docs">agent docs</a></footer>
    </main>

    <script>
      var form = document.getElementById('create-form');
      var submit = document.getElementById('submit');
      var errorBox = document.getElementById('error');

      function showError(message) {
        errorBox.textContent = message;
        errorBox.style.display = 'block';
        submit.disabled = false;
        submit.textContent = 'Create document';
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        errorBox.style.display = 'none';

        var markdown = document.getElementById('markdown').value;
        if (!markdown.trim()) {
          showError('Add some document text first.');
          return;
        }
        var title = document.getElementById('title').value.trim();

        submit.disabled = true;
        submit.textContent = 'Creating…';

        fetch('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown: markdown,
            title: title || undefined,
            blindMode: document.getElementById('blindMode').checked,
          }),
        })
          .then(function (response) {
            return response.json().then(function (body) {
              return { ok: response.ok, body: body };
            });
          })
          .then(function (result) {
            if (!result.ok || !result.body || !result.body.slug) {
              showError((result.body && result.body.error) || 'Could not create the document.');
              return;
            }
            // The owner secret (not the editor access token) is what unlocks the
            // reveal switch, and /d/:slug persists a query token to a cookie.
            window.location.href = '/d/' + encodeURIComponent(result.body.slug)
              + '?token=' + encodeURIComponent(result.body.ownerSecret);
          })
          .catch(function (error) {
            showError('Could not create the document: ' + error);
          });
      });
    </script>
  </body>
</html>`;

newDocumentRoutes.get('/new', (_req, res) => {
  res.type('html').send(NEW_DOCUMENT_HTML);
});
