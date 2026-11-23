import 'katex/dist/katex.min.css';
import '@mathslot/ui/styles.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) {
  mount(App, { target });
}
