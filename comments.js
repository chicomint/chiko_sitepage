(() => {
  'use strict';
  function render(comment) {
    const row = document.createElement('div'); row.className = 'blog-comment'; row.dataset.commentId = comment._id;
    const body = document.createElement('div'); body.className = 'comment-content';
    const meta = document.createElement('div'); meta.className = 'comment-meta';
    const name = document.createElement('strong'); name.textContent = comment.username; meta.append(name);
    if (/^[A-Z]{2}$/.test(comment.country || '')) { const flag = document.createElement('span'); flag.textContent = [...comment.country].map(x => String.fromCodePoint(127397 + x.charCodeAt(0))).join(''); flag.title = comment.country; meta.append(flag); }
    if (comment.website) { const link = document.createElement('a'); link.href = comment.website; link.textContent = '[' + new URL(comment.website).hostname + ']'; link.target = '_blank'; link.rel = 'nofollow ugc noopener noreferrer'; meta.append(link); }
    const time = document.createElement('time'); time.dateTime = comment.createdAt; time.textContent = new Date(comment.createdAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'medium' }); meta.append(time);
    const message = document.createElement('p'); message.textContent = comment.message;
    body.append(meta, message); row.append(body); return row;
  }
  for (const section of document.querySelectorAll('.blog-comments')) {
    const form = section.querySelector('form'), list = section.querySelector('.comment-list'), more = section.querySelector('.comments-more');
    const status = section.querySelector('.comment-status'), submit = form.querySelector('[type=submit]'), empty = section.querySelector('.comments-empty');
    const endpoint = '/api/comments/' + section.dataset.blogId;
    let loading = false;
    async function load(append = false) {
      if (loading) return; loading = true; more.disabled = true;
      try {
        const response = await fetch(endpoint + (append ? '?before=' + encodeURIComponent(more.dataset.next) : ''), { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Could not load comments. Please refresh to try again.');
        const data = await response.json();
        if (!append) list.replaceChildren();
        for (const comment of data.comments) if (!list.querySelector(`[data-comment-id="${comment._id}"]`)) list.append(render(comment));
        more.dataset.next = data.next || ''; more.hidden = !data.next; empty.hidden = !!list.children.length;
        if (!append || !form.elements.token.value) form.elements.token.value = data.token;
        submit.disabled = false; status.textContent = '';
      } catch (error) { status.textContent = error.message; }
      finally { loading = false; more.disabled = false; }
    }
    more.addEventListener('click', () => load(true));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submit.disabled) return;
      submit.disabled = true; status.textContent = 'Posting…';
      try {
        const data = Object.fromEntries(new FormData(form));
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not post your comment.');
        if (result.comment) { list.prepend(render(result.comment)); empty.hidden = true; }
        form.elements.message.value = ''; form.elements.token.value = result.token;
        status.textContent = result.pending ? 'Submitted for approval. Thank you!' : 'Comment posted. Thank you!';
      } catch (error) { status.textContent = ['TimeoutError', 'TypeError'].includes(error.name) ? 'Connection failed. Your message is still here; try again.' : error.message; }
      finally { submit.disabled = false; }
    });
    load();
  }
})();
