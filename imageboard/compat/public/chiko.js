'use strict';
const root=document.documentElement;
try { root.dataset.theme=localStorage.getItem('chikochan-theme') || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); } catch {}
document.getElementById('theme')?.addEventListener('click',()=>{
  root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';
  try{localStorage.setItem('chikochan-theme',root.dataset.theme);}catch{}
});
document.querySelectorAll('[data-quote]').forEach(button=>button.addEventListener('click',()=>{
  const input=document.getElementById('message');
  if(!input)return;
  input.closest('details').open=true;
  input.value+=`${input.value&&!input.value.endsWith('\n')?'\n':''}>>${button.dataset.quote}\n`;
  input.focus();input.scrollIntoView({behavior:'smooth',block:'center'});
}));
