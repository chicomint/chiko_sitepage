/* Homepage chess. Copyright 2026 Chicomint. SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';

  const root = document.querySelector('.chess-corner');
  if (!root) return;
  const base = new URL('.', document.currentScript.src);
  const find = id => root.querySelector('#chess-' + id);
  const board = find('board'), status = find('status'), start = find('start');
  if (!window.ChikoChessRules || !window.ChikoChessground) {
    status.classList.add('chess-notice');
    status.textContent = 'The board could not load. Please refresh to try again.';
    return;
  }

  const game = new window.ChikoChessRules.Chess();
  const difficulty = find('difficulty'), color = find('color');
  const promotionBox = find('promotion');
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const colors = { w: 'White', b: 'Black' };
  // Skill Level is Stockfish's own strength control; these are not Elo ratings.
  const levels = {
    gentle: { skill: 0, depth: 2, time: 150 },
    easy: { skill: 3, depth: 4, time: 250 },
    medium: { skill: 8, depth: 8, time: 500 },
    hard: { skill: 14, depth: 12, time: 1000 },
    expert: { skill: 20, depth: 18, time: 1800 },
  };
  let player = 'w', promotion = null, keyboardSquare = 'e2';
  let active = false, ready = false, thinking = false, error = '';
  let worker = null, timer = null, searchFen = null;
  const ground = window.ChikoChessground.Chessground(board, {
    coordinates: true,
    ranksPosition: 'right',
    animation: { enabled: !matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 200 },
    movable: { free: false, color: undefined, dests: new Map(), events: { after: onBoardMove } },
    premovable: { enabled: false },
    draggable: { enabled: true, showGhost: true },
    drawable: { enabled: true },
  });

  function playable() {
    return active && ready && !thinking && !error && !promotion &&
      game.turn() === player && !game.isGameOver();
  }

  function result() {
    if (game.isCheckmate()) return game.turn() === player ? 'Checkmate — Stockfish wins. Another game? :3' : 'Checkmate — you win! :3';
    if (game.isStalemate()) return 'Draw by stalemate. Another game?';
    if (game.isThreefoldRepetition()) return 'Draw by threefold repetition.';
    if (game.isInsufficientMaterial()) return 'Draw — not enough material to checkmate.';
    if (game.isDrawByFiftyMoves()) return 'Draw by the fifty-move rule.';
    return 'Draw. Another game?';
  }

  function render() {
    const history = game.history({ verbose: true });
    const last = history.at(-1);
    const destinations = new Map();
    if (playable()) {
      for (const move of game.moves({ verbose: true })) {
        if (!destinations.has(move.from)) destinations.set(move.from, []);
        if (!destinations.get(move.from).includes(move.to)) destinations.get(move.from).push(move.to);
      }
    }
    ground.set({
      fen: game.fen(),
      orientation: colors[player].toLowerCase(),
      turnColor: colors[game.turn()].toLowerCase(),
      check: game.isCheck(),
      lastMove: last ? [last.from, last.to] : undefined,
      movable: { color: playable() ? colors[player].toLowerCase() : undefined, dests: destinations },
    });
    board.setAttribute('aria-label', 'Chessboard, ' + colors[player] + ' at the bottom. ' + squareDescription());
    board.setAttribute('aria-disabled', String(!playable()));
    promotionBox.hidden = !promotion;
    board.setAttribute('aria-busy', String(active && (!ready || thinking) && !error));
    start.hidden = !error && !game.isGameOver();
    start.textContent = error ? 'Retry engine' : 'Play again';
    status.classList.toggle('chess-notice', !!error || game.isGameOver());
    if (error) status.textContent = error;
    else if (!active) status.textContent = 'Choose a difficulty and a side. Select a piece to play.';
    else if (game.isGameOver()) status.textContent = result();
    else if (!ready) status.textContent = 'Loading Stockfish… just a moment :3';
    else if (promotion) status.textContent = 'Choose a piece for your pawn to become.';
    else if (thinking) status.textContent = 'Stockfish is thinking…';
    else status.textContent = (game.isCheck() ? 'Check! ' : '') + 'Your turn — you’re playing ' + colors[player] + '.';
  }

  function onBoardMove(from, to) {
    if (!playable()) { render(); return; }
    const candidates = game.moves({ square: from, verbose: true }).filter(move => move.to === to);
    if (!candidates.length) { render(); return; }
    if (candidates.some(move => move.promotion)) {
      promotion = { from, to };
      render();
      promotionBox.querySelector('button').focus();
    } else makeMove({ from, to });
  }

  function makeMove(move) {
    game.move(move);
    promotion = null;
    render();
    askEngine();
  }

  function disconnect() {
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    ready = thinking = false;
    searchFen = null;
  }

  function connect(useJavaScript = false) {
    disconnect();
    error = '';
    render();
    const fail = () => {
      disconnect();
      if (!useJavaScript && location.protocol !== 'file:') { connect(true); return; }
      error = location.protocol === 'file:' ? 'Open the live site or a local web server to play chess.' : 'Stockfish couldn’t load. Check your connection, then retry.';
      render();
    };
    try {
      const useWasm = !useJavaScript && typeof WebAssembly === 'object';
      const instance = new Worker(new URL('vendor/stockfish/' + (useWasm ? 'stockfish.wasm.js' : 'stockfish.js'), base));
      worker = instance;
      timer = setTimeout(fail, 20000);
      instance.addEventListener('error', event => {
        event.preventDefault();
        if (worker === instance) fail();
      });
      instance.addEventListener('message', event => {
        if (worker !== instance || typeof event.data !== 'string') return;
        const line = event.data.trim();
        if (line === 'uciok') {
          instance.postMessage('setoption name Hash value 16');
          instance.postMessage('ucinewgame');
          instance.postMessage('isready');
        } else if (line === 'readyok' && !ready) {
          clearTimeout(timer);
          ready = true;
          render();
          askEngine();
        } else if (line.startsWith('bestmove ') && thinking) {
          clearTimeout(timer);
          thinking = false;
          if (searchFen !== game.fen() || game.turn() === player || game.isGameOver()) { render(); return; }
          const move = line.split(/\s+/)[1];
          try {
            game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || 'q' });
            render();
          } catch { fail(); }
        }
      });
      instance.postMessage('uci');
    } catch { fail(); }
  }

  function askEngine() {
    if (!active || !ready || thinking || error || game.turn() === player || game.isGameOver()) return;
    const level = levels[difficulty.value] || levels.easy;
    thinking = true;
    searchFen = game.fen();
    render();
    worker.postMessage('setoption name Skill Level value ' + level.skill);
    worker.postMessage('position fen ' + searchFen);
    worker.postMessage('go depth ' + level.depth + ' movetime ' + level.time);
    timer = setTimeout(() => {
      disconnect();
      error = 'Stockfish stopped responding. Retry to continue this game.';
      render();
    }, 15000);
  }

  function beginGame() {
    game.reset();
    player = color.value;
    promotion = null;
    keyboardSquare = player === 'w' ? 'e2' : 'e7';
    ground.cancelMove();
    active = true;
    connect();
  }

  start.addEventListener('click', () => { if (error) connect(); else beginGame(); });
  color.addEventListener('change', beginGame);
  difficulty.addEventListener('change', () => {
    if (active && ready && !thinking && !game.isGameOver() && !promotion) {
      status.textContent = 'Difficulty: ' + difficulty.selectedOptions[0].textContent + '. Your turn — ' + colors[player] + '.';
    }
  });

  promotionBox.addEventListener('click', event => {
    const choice = event.target.closest('[data-promotion]')?.dataset.promotion;
    if (!choice || !promotion) return;
    const move = promotion;
    if (choice === 'cancel') { promotion = null; render(); keyboardSquare = move.from; }
    else { makeMove({ ...move, promotion: choice }); keyboardSquare = move.to; }
    board.focus({ preventScroll: true });
  });

  function squareDescription() {
    const piece = game.get(keyboardSquare);
    return keyboardSquare + ', ' + (piece ? colors[piece.color] + ' ' + names[piece.type] : 'empty');
  }

  function keyboardFocus() {
    ground.set({ highlight: { custom: new Map(board.matches(':focus-visible') ? [[keyboardSquare, 'keyboard-focus']] : []) } });
    board.setAttribute('aria-label', 'Chessboard. ' + squareDescription());
    if (playable()) status.textContent = squareDescription();
  }

  board.addEventListener('focus', keyboardFocus);
  board.addEventListener('blur', () => ground.set({ highlight: { custom: new Map() } }));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      promotion = null;
      ground.cancelMove();
      render();
      return;
    }
    if (event.target !== board) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (playable()) ground.selectSquare(keyboardSquare);
      return;
    }
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const files = player === 'w' ? 'abcdefgh' : 'hgfedcba';
    const rank = Number(keyboardSquare[1]);
    const index = (player === 'w' ? 8 - rank : rank - 1) * 8 + files.indexOf(keyboardSquare[0]);
    const next = index + offset;
    if (next < 0 || next > 63 || (Math.abs(offset) === 1 && Math.floor(index / 8) !== Math.floor(next / 8))) return;
    keyboardSquare = files[next % 8] + (player === 'w' ? 8 - Math.floor(next / 8) : Math.floor(next / 8) + 1);
    keyboardFocus();
  });

  const enlarge = find('enlarge'), shrink = find('shrink');
  function setExpanded(expanded) {
    root.classList.toggle('chess-expanded', expanded);
    enlarge.hidden = expanded;
    shrink.hidden = !expanded;
    board.tabIndex = expanded ? 0 : -1;
    if (expanded) {
      if (!active) beginGame();
      board.focus({ preventScroll: true });
    } else enlarge.focus({ preventScroll: true });
    // Recompute Chessground's drag/drop coordinates after its CSS size changes.
    requestAnimationFrame(() => ground.redrawAll());
  }
  enlarge.addEventListener('click', () => setExpanded(true));
  shrink.addEventListener('click', () => setExpanded(false));
  board.tabIndex = -1;

  window.addEventListener('pagehide', () => {
    disconnect();
    if (active && !game.isGameOver()) {
      error = 'Welcome back! Retry the engine to continue your game.';
      render();
    }
  });
  render();
  // Load the engine only when the little board comes into view or is used.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        if (!active) beginGame();
      }
    });
    observer.observe(board);
  }
})();
