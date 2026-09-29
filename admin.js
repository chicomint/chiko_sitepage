(() => {
  const form = document.getElementById('content-form');
  const editor = document.getElementById('bbcode');
  const csrf = document.querySelector('input[name="csrf"]')?.value;
  function insert(value) {
    if (!editor) return;
    editor.setRangeText(value, editor.selectionStart, editor.selectionEnd, 'end');
    editor.focus();
  }
  for (const button of document.querySelectorAll('[data-tag]')) button.addEventListener('click', () => {
    const tag = button.dataset.tag;
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd) || (tag === 'list' ? '\n[*]item\n[*]item\n' : 'text');
    let attribute = '';
    if (['url', 'color', 'size'].includes(tag)) {
      const answer = prompt({ url: 'Link URL', color: 'Color name or hex', size: 'Font size (8–32 pixels)' }[tag], { url: 'https://', color: 'red', size: '18' }[tag]);
      if (answer === null) return; attribute = '=' + answer;
    }
    if (['img', 'video'].includes(tag)) { const url = prompt('Media URL', 'https://'); if (url) insert(`[${tag}]${url}[/${tag}]`); return; }
    insert(`[${tag}${attribute}]${selected}[/${tag}]`);
  });
  document.getElementById('preview-button')?.addEventListener('click', async () => {
    const status = document.getElementById('editor-status'); status.textContent = 'Loading preview…';
    try {
      const response = await fetch('/api/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
      const frame = document.getElementById('preview-frame');
      // The server escapes all fields and renders allowlisted, sanitized BBCode.
      // The sandbox also disables scripts and prevents access to the parent page.
      frame.srcdoc = await response.text(); frame.hidden = false; status.textContent = 'Preview ready.';
    } catch (error) { status.textContent = error.message || 'Preview failed.'; }
  });
  function useImage(url) {
    if (editor) insert(`[img]${url}[/img]`);
    else if (form) form.elements.image.value = url;
  }
  document.getElementById('insert-image')?.addEventListener('click', () => {
    const url = document.getElementById('image-library').value;
    if (url) useImage(url);
  });
  document.getElementById('image-upload')?.addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    const status = document.getElementById('upload-status');
    if (file.size > 10 * 1024 * 1024) { status.textContent = 'Maximum upload size is 10 MiB.'; return; }
    status.textContent = 'Uploading…'; event.target.disabled = true;
    try {
      const response = await fetch('/api/admin/uploads', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-CSRF-Token': csrf }, body: file });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      status.textContent = `Uploaded: ${data.url}`;
      const library = document.getElementById('image-library');
      if (library) { library.add(new Option(file.name, data.url, true, true)); useImage(data.url); }
      else { const link = document.createElement('a'); link.href = '/admin/uploads'; link.textContent = ' Refresh library'; status.append(link); }
    } catch (error) { status.textContent = error.message || 'Upload failed.'; }
    finally { event.target.disabled = false; }
  });
})();
