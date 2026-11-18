import { createShell } from '../../shared/shell.js';
import { createGame } from './logic.mjs';
import { render } from './render.mjs';
import { createInput } from './input.mjs';
import { chooseMove } from './ai.mjs';

createShell({
  metaUrl: './game.json',
  createGame,
  render,
  createInput,
  ai: { choose: chooseMove },
});
