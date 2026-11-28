import 'katex/dist/katex.min.css';
import '@mathslot/ui/styles.css';
import { mount } from 'svelte';
import App from './App.svelte';

if ('serviceWorker' in navigator && import.meta.env.PROD && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

mount(App, {
  target: document.getElementById('app')!,
});
