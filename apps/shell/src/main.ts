import { mount } from 'svelte';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.svelte';
import { Shell } from './shell.ts';

const shell = new Shell();
mount(App, { target: document.getElementById('app')!, props: { shell } });
