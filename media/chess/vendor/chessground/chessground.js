var ChikoChessground = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod2) => __copyProps(__defProp({}, "__esModule", { value: true }), mod2);

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/chessground.js
  var chessground_exports = {};
  __export(chessground_exports, {
    Chessground: () => Chessground,
    initModule: () => initModule
  });

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/types.js
  var colors = ["white", "black"];
  var files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  var ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/util.js
  var invRanks = [...ranks].reverse();
  var allKeys = files.flatMap((f) => ranks.map((r) => f + r));
  var pos2key = (pos) => pos.every((x) => x >= 0 && x <= 7) ? allKeys[8 * pos[0] + pos[1]] : void 0;
  var pos2keyUnsafe = (pos) => pos2key(pos);
  var key2pos = (k) => [k.charCodeAt(0) - 97, k.charCodeAt(1) - 49];
  var allPos = allKeys.map(key2pos);
  var allPosAndKey = allKeys.map((key, i) => ({ key, pos: allPos[i] }));
  function memo(f) {
    let v;
    const ret = () => {
      if (v === void 0)
        v = f();
      return v;
    };
    ret.clear = () => {
      v = void 0;
    };
    return ret;
  }
  var timer = () => {
    let startAt;
    return {
      start() {
        startAt = performance.now();
      },
      cancel() {
        startAt = void 0;
      },
      stop() {
        if (!startAt)
          return 0;
        const time = performance.now() - startAt;
        startAt = void 0;
        return time;
      }
    };
  };
  var opposite = (c) => c === "white" ? "black" : "white";
  var distanceSq = (pos1, pos2) => (pos1[0] - pos2[0]) ** 2 + (pos1[1] - pos2[1]) ** 2;
  var samePiece = (p1, p2) => p1.role === p2.role && p1.color === p2.color;
  var samePos = (p1, p2) => p1[0] === p2[0] && p1[1] === p2[1];
  var posToTranslate = (bounds) => (pos, asWhite) => [
    (asWhite ? pos[0] : 7 - pos[0]) * bounds.width / 8,
    (asWhite ? 7 - pos[1] : pos[1]) * bounds.height / 8
  ];
  var translate = (el, pos) => {
    el.style.transform = `translate(${pos[0]}px,${pos[1]}px)`;
  };
  var translateAndScale = (el, pos, scale = 1) => {
    el.style.transform = `translate(${pos[0]}px,${pos[1]}px) scale(${scale})`;
  };
  var setVisible = (el, v) => {
    el.style.display = v ? "" : "none";
  };
  var eventPosition = (e) => {
    if (e.clientX || e.clientX === 0)
      return [e.clientX, e.clientY];
    if (e.targetTouches?.[0])
      return [e.targetTouches[0].clientX, e.targetTouches[0].clientY];
    return void 0;
  };
  var isFireMac = memo(() => !("ontouchstart" in window) && ["macintosh", "firefox"].every((x) => navigator.userAgent.toLowerCase().includes(x)));
  var isRightButton = (e) => e.button === 2 && !(e.ctrlKey && isFireMac());
  var createEl = (tagName, className) => {
    const el = document.createElement(tagName);
    if (className)
      el.className = className;
    return el;
  };
  function computeSquareCenter(key, asWhite, bounds) {
    const pos = key2pos(key);
    if (!asWhite) {
      pos[0] = 7 - pos[0];
      pos[1] = 7 - pos[1];
    }
    return [
      bounds.left + bounds.width * pos[0] / 8 + bounds.width / 16,
      bounds.top + bounds.height * (7 - pos[1]) / 8 + bounds.height / 16
    ];
  }
  var diff = (a, b) => Math.abs(a - b);
  var knightDir = (x1, y1, x2, y2) => diff(x1, x2) * diff(y1, y2) === 2;
  var rookDir = (x1, y1, x2, y2) => x1 === x2 !== (y1 === y2);
  var bishopDir = (x1, y1, x2, y2) => diff(x1, x2) === diff(y1, y2) && x1 !== x2;
  var queenDir = (x1, y1, x2, y2) => rookDir(x1, y1, x2, y2) || bishopDir(x1, y1, x2, y2);
  var kingDirNonCastling = (x1, y1, x2, y2) => Math.max(diff(x1, x2), diff(y1, y2)) === 1;
  var pawnDirAdvance = (x1, y1, x2, y2, isDirectionUp) => {
    const step2 = isDirectionUp ? 1 : -1;
    return x1 === x2 && (y2 === y1 + step2 || // allow 2 squares from first two ranks, for horde
    y2 === y1 + 2 * step2 && (isDirectionUp ? y1 <= 1 : y1 >= 6));
  };
  var squaresBetween = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx && dy && Math.abs(dx) !== Math.abs(dy))
      return [];
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    const squares = [];
    let x = x1 + stepX, y = y1 + stepY;
    while (x !== x2 || y !== y2) {
      squares.push([x, y]);
      x += stepX;
      y += stepY;
    }
    return squares.map(pos2key).filter((k) => k !== void 0);
  };

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/anim.js
  var anim = (mutation, state) => state.animation.enabled ? animate(mutation, state) : render(mutation, state);
  function render(mutation, state) {
    const result = mutation(state);
    state.dom.redraw();
    return result;
  }
  var makePiece = (key, piece) => ({
    key,
    pos: key2pos(key),
    piece
  });
  var closer = (piece, pieces) => pieces.sort((p1, p2) => distanceSq(piece.pos, p1.pos) - distanceSq(piece.pos, p2.pos))[0];
  function computePlan(prevPieces, current) {
    const anims = /* @__PURE__ */ new Map(), animedOrigs = [], fadings = /* @__PURE__ */ new Map(), missings = [], news = [], prePieces = /* @__PURE__ */ new Map();
    let curP, preP, vector;
    for (const [k, p] of prevPieces) {
      prePieces.set(k, makePiece(k, p));
    }
    for (const key of allKeys) {
      curP = current.pieces.get(key);
      preP = prePieces.get(key);
      if (curP) {
        if (preP) {
          if (!samePiece(curP, preP.piece)) {
            missings.push(preP);
            news.push(makePiece(key, curP));
          }
        } else
          news.push(makePiece(key, curP));
      } else if (preP)
        missings.push(preP);
    }
    for (const newP of news) {
      preP = closer(newP, missings.filter((p) => samePiece(newP.piece, p.piece)));
      if (preP) {
        vector = [preP.pos[0] - newP.pos[0], preP.pos[1] - newP.pos[1]];
        anims.set(newP.key, vector.concat(vector));
        animedOrigs.push(preP.key);
      }
    }
    for (const p of missings) {
      if (!animedOrigs.includes(p.key))
        fadings.set(p.key, p.piece);
    }
    return {
      anims,
      fadings
    };
  }
  function step(state, now) {
    const cur = state.animation.current;
    if (cur === void 0) {
      if (!state.dom.destroyed)
        state.dom.redrawNow();
      return;
    }
    const rest = 1 - (now - cur.start) * cur.frequency;
    if (rest <= 0) {
      state.animation.current = void 0;
      state.dom.redrawNow();
    } else {
      const ease = easing(rest);
      for (const cfg of cur.plan.anims.values()) {
        cfg[2] = cfg[0] * ease;
        cfg[3] = cfg[1] * ease;
      }
      state.dom.redrawNow(true);
      requestAnimationFrame((now2 = performance.now()) => step(state, now2));
    }
  }
  function animate(mutation, state) {
    const prevPieces = new Map(state.pieces);
    const result = mutation(state);
    const plan = computePlan(prevPieces, state);
    if (plan.anims.size || plan.fadings.size) {
      const alreadyRunning = state.animation.current && state.animation.current.start;
      state.animation.current = {
        start: performance.now(),
        frequency: 1 / state.animation.duration,
        plan
      };
      if (!alreadyRunning)
        step(state, performance.now());
    } else {
      state.dom.redraw();
    }
    return result;
  }
  var easing = (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/premove.js
  var pawn = (ctx) => diff(ctx.orig.pos[0], ctx.dest.pos[0]) <= 1 && (diff(ctx.orig.pos[0], ctx.dest.pos[0]) === 1 ? ctx.dest.pos[1] === ctx.orig.pos[1] + (ctx.color === "white" ? 1 : -1) : pawnDirAdvance(...ctx.orig.pos, ...ctx.dest.pos, ctx.color === "white"));
  var knight = (ctx) => knightDir(...ctx.orig.pos, ...ctx.dest.pos);
  var bishop = (ctx) => bishopDir(...ctx.orig.pos, ...ctx.dest.pos);
  var rook = (ctx) => rookDir(...ctx.orig.pos, ...ctx.dest.pos);
  var queen = (ctx) => bishop(ctx) || rook(ctx);
  var king = (ctx) => kingDirNonCastling(...ctx.orig.pos, ...ctx.dest.pos) || ctx.orig.pos[1] === ctx.dest.pos[1] && ctx.orig.pos[1] === (ctx.color === "white" ? 0 : 7) && (ctx.orig.pos[0] === 4 && (ctx.dest.pos[0] === 2 && ctx.rookFilesFriendlies.includes(0) || ctx.dest.pos[0] === 6 && ctx.rookFilesFriendlies.includes(7)) || ctx.rookFilesFriendlies.includes(ctx.dest.pos[0]));
  var mobilityByRole = { pawn, knight, bishop, rook, queen, king };
  function premove(state, key) {
    const pieces = state.pieces;
    const piece = pieces.get(key);
    if (!piece || piece.color === state.turnColor)
      return [];
    const color = piece.color, friendlies = new Map([...pieces].filter(([_, p]) => p.color === color)), enemies = new Map([...pieces].filter(([_, p]) => p.color === opposite(color))), orig = { key, pos: key2pos(key) }, mobility = (ctx) => mobilityByRole[piece.role](ctx) && state.premovable.additionalPremoveRequirements(ctx), partialCtx = {
      orig,
      role: piece.role,
      allPieces: pieces,
      friendlies,
      enemies,
      color,
      rookFilesFriendlies: Array.from(pieces).filter(([k, p]) => k[1] === (color === "white" ? "1" : "8") && p.color === color && p.role === "rook").map(([k]) => key2pos(k)[0]),
      lastMove: state.lastMove
    };
    return allPosAndKey.filter((dest) => mobility({ ...partialCtx, dest })).map((pk) => pk.key);
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/board.js
  function callUserFunction(f, ...args) {
    if (f)
      setTimeout(() => f(...args), 1);
  }
  function toggleOrientation(state) {
    state.orientation = opposite(state.orientation);
    state.animation.current = state.draggable.current = state.selected = void 0;
  }
  function setPieces(state, pieces) {
    for (const [key, piece] of pieces) {
      if (piece)
        state.pieces.set(key, piece);
      else
        state.pieces.delete(key);
    }
  }
  function setCheck(state, color) {
    state.check = void 0;
    if (color === true)
      color = state.turnColor;
    if (color)
      for (const [k, p] of state.pieces) {
        if (p.role === "king" && p.color === color) {
          state.check = k;
        }
      }
  }
  function setPremove(state, orig, dest, meta) {
    unsetPredrop(state);
    state.premovable.current = [orig, dest];
    callUserFunction(state.premovable.events.set, orig, dest, meta);
  }
  function unsetPremove(state) {
    if (state.premovable.current) {
      state.premovable.current = void 0;
      callUserFunction(state.premovable.events.unset);
    }
  }
  function setPredrop(state, role, key) {
    unsetPremove(state);
    state.predroppable.current = { role, key };
    callUserFunction(state.predroppable.events.set, role, key);
  }
  function unsetPredrop(state) {
    const pd = state.predroppable;
    if (pd.current) {
      pd.current = void 0;
      callUserFunction(pd.events.unset);
    }
  }
  function tryAutoCastle(state, orig, dest) {
    if (!state.autoCastle)
      return false;
    const king2 = state.pieces.get(orig);
    if (!king2 || king2.role !== "king")
      return false;
    const origPos = key2pos(orig);
    const destPos = key2pos(dest);
    if (origPos[1] !== 0 && origPos[1] !== 7 || origPos[1] !== destPos[1])
      return false;
    if (origPos[0] === 4 && !state.pieces.has(dest)) {
      if (destPos[0] === 6)
        dest = pos2keyUnsafe([7, destPos[1]]);
      else if (destPos[0] === 2)
        dest = pos2keyUnsafe([0, destPos[1]]);
    }
    const rook2 = state.pieces.get(dest);
    if (!rook2 || rook2.color !== king2.color || rook2.role !== "rook")
      return false;
    state.pieces.delete(orig);
    state.pieces.delete(dest);
    if (origPos[0] < destPos[0]) {
      state.pieces.set(pos2keyUnsafe([6, destPos[1]]), king2);
      state.pieces.set(pos2keyUnsafe([5, destPos[1]]), rook2);
    } else {
      state.pieces.set(pos2keyUnsafe([2, destPos[1]]), king2);
      state.pieces.set(pos2keyUnsafe([3, destPos[1]]), rook2);
    }
    return true;
  }
  function tryEnPassant(state, orig, dest) {
    const origPiece = state.pieces.get(orig);
    if (!origPiece || origPiece.role !== "pawn")
      return void 0;
    const origPos = key2pos(orig);
    const destPos = key2pos(dest);
    if (origPos[0] === destPos[0])
      return void 0;
    if (state.pieces.has(dest))
      return void 0;
    const captureKey = pos2key([destPos[0], origPos[1]]);
    if (!captureKey)
      return void 0;
    const captured = state.pieces.get(captureKey);
    if (!captured || captured.color === origPiece.color || captured.role !== "pawn")
      return void 0;
    state.pieces.delete(captureKey);
    return captured;
  }
  function baseMove(state, orig, dest) {
    const origPiece = state.pieces.get(orig), destPiece = state.pieces.get(dest);
    if (orig === dest || !origPiece)
      return false;
    const captured = destPiece && destPiece.color !== origPiece.color ? destPiece : tryEnPassant(state, orig, dest);
    if (dest === state.selected)
      unselect(state);
    callUserFunction(state.events.move, orig, dest, captured);
    if (!tryAutoCastle(state, orig, dest)) {
      state.pieces.set(dest, origPiece);
      state.pieces.delete(orig);
    }
    state.lastMove = [orig, dest];
    state.check = void 0;
    callUserFunction(state.events.change);
    return captured || true;
  }
  function baseNewPiece(state, piece, key, force) {
    if (state.pieces.has(key)) {
      if (force)
        state.pieces.delete(key);
      else
        return false;
    }
    callUserFunction(state.events.dropNewPiece, piece, key);
    state.pieces.set(key, piece);
    state.lastMove = [key];
    state.check = void 0;
    callUserFunction(state.events.change);
    state.movable.dests = void 0;
    state.turnColor = opposite(state.turnColor);
    return true;
  }
  function baseUserMove(state, orig, dest) {
    const result = baseMove(state, orig, dest);
    if (result) {
      state.movable.dests = void 0;
      state.turnColor = opposite(state.turnColor);
      state.animation.current = void 0;
    }
    return result;
  }
  function userMove(state, orig, dest) {
    if (canMove(state, orig, dest)) {
      const result = baseUserMove(state, orig, dest);
      if (result) {
        const holdTime = state.hold.stop();
        unselect(state);
        const metadata = {
          premove: false,
          ctrlKey: state.stats.ctrlKey,
          holdTime
        };
        if (result !== true)
          metadata.captured = result;
        callUserFunction(state.movable.events.after, orig, dest, metadata);
        return true;
      }
    } else if (canPremove(state, orig, dest)) {
      setPremove(state, orig, dest, {
        ctrlKey: state.stats.ctrlKey
      });
      unselect(state);
      return true;
    }
    unselect(state);
    return false;
  }
  function dropNewPiece(state, orig, dest, force) {
    const piece = state.pieces.get(orig);
    if (piece && (canDrop(state, orig, dest) || force)) {
      state.pieces.delete(orig);
      baseNewPiece(state, piece, dest, force);
      callUserFunction(state.movable.events.afterNewPiece, piece.role, dest, {
        premove: false,
        predrop: false
      });
    } else if (piece && canPredrop(state, orig, dest)) {
      setPredrop(state, piece.role, dest);
    } else {
      unsetPremove(state);
      unsetPredrop(state);
    }
    state.pieces.delete(orig);
    unselect(state);
  }
  function selectSquare(state, key, force) {
    callUserFunction(state.events.select, key);
    if (state.selected) {
      if (state.selected === key && !state.draggable.enabled) {
        unselect(state);
        state.hold.cancel();
        return;
      } else if ((state.selectable.enabled || force) && state.selected !== key) {
        if (userMove(state, state.selected, key)) {
          state.stats.dragged = false;
          return;
        }
      }
    }
    if ((state.selectable.enabled || state.draggable.enabled) && (isMovable(state, key) || isPremovable(state, key))) {
      setSelected(state, key);
      state.hold.start();
    }
  }
  function setSelected(state, key) {
    state.selected = key;
    if (!isPremovable(state, key))
      state.premovable.dests = void 0;
    else if (!state.premovable.customDests)
      state.premovable.dests = premove(state, key);
  }
  function unselect(state) {
    state.selected = void 0;
    state.premovable.dests = void 0;
    state.hold.cancel();
  }
  function isMovable(state, orig) {
    const piece = state.pieces.get(orig);
    return !!piece && (state.movable.color === "both" || state.movable.color === piece.color && state.turnColor === piece.color);
  }
  var canMove = (state, orig, dest) => orig !== dest && isMovable(state, orig) && (state.movable.free || !!state.movable.dests?.get(orig)?.includes(dest));
  function canDrop(state, orig, dest) {
    const piece = state.pieces.get(orig);
    return !!piece && (orig === dest || !state.pieces.has(dest)) && (state.movable.color === "both" || state.movable.color === piece.color && state.turnColor === piece.color);
  }
  function isPremovable(state, orig) {
    const piece = state.pieces.get(orig);
    return !!piece && state.premovable.enabled && state.movable.color === piece.color && state.turnColor !== piece.color;
  }
  var canPremove = (state, orig, dest) => orig !== dest && isPremovable(state, orig) && (state.premovable.customDests?.get(orig) ?? premove(state, orig)).includes(dest);
  function canPredrop(state, orig, dest) {
    const piece = state.pieces.get(orig);
    const destPiece = state.pieces.get(dest);
    return !!piece && (!destPiece || destPiece.color !== state.movable.color) && state.predroppable.enabled && (piece.role !== "pawn" || dest[1] !== "1" && dest[1] !== "8") && state.movable.color === piece.color && state.turnColor !== piece.color;
  }
  function isDraggable(state, orig) {
    const piece = state.pieces.get(orig);
    return !!piece && state.draggable.enabled && (state.movable.color === "both" || state.movable.color === piece.color && (state.turnColor === piece.color || state.premovable.enabled));
  }
  function playPremove(state) {
    const move3 = state.premovable.current;
    if (!move3)
      return false;
    const orig = move3[0], dest = move3[1];
    let success = false;
    if (canMove(state, orig, dest)) {
      const result = baseUserMove(state, orig, dest);
      if (result) {
        const metadata = { premove: true };
        if (result !== true)
          metadata.captured = result;
        callUserFunction(state.movable.events.after, orig, dest, metadata);
        success = true;
      }
    }
    unsetPremove(state);
    return success;
  }
  function playPredrop(state, validate) {
    const drop2 = state.predroppable.current;
    let success = false;
    if (!drop2)
      return false;
    if (validate(drop2)) {
      const piece = {
        role: drop2.role,
        color: state.movable.color
      };
      if (baseNewPiece(state, piece, drop2.key)) {
        callUserFunction(state.movable.events.afterNewPiece, drop2.role, drop2.key, {
          premove: false,
          predrop: true
        });
        success = true;
      }
    }
    unsetPredrop(state);
    return success;
  }
  function cancelMove(state) {
    unsetPremove(state);
    unsetPredrop(state);
    unselect(state);
  }
  function stop(state) {
    state.movable.color = state.movable.dests = state.animation.current = void 0;
    cancelMove(state);
  }
  function getKeyAtDomPos(pos, asWhite, bounds) {
    let file = Math.floor(8 * (pos[0] - bounds.left) / bounds.width);
    if (!asWhite)
      file = 7 - file;
    let rank = 7 - Math.floor(8 * (pos[1] - bounds.top) / bounds.height);
    if (!asWhite)
      rank = 7 - rank;
    return file >= 0 && file < 8 && rank >= 0 && rank < 8 ? pos2key([file, rank]) : void 0;
  }
  function getSnappedKeyAtDomPos(orig, pos, asWhite, bounds) {
    const origPos = key2pos(orig);
    const validSnapPos = allPos.filter((pos2) => samePos(origPos, pos2) || queenDir(origPos[0], origPos[1], pos2[0], pos2[1]) || knightDir(origPos[0], origPos[1], pos2[0], pos2[1]));
    const validSnapCenters = validSnapPos.map((pos2) => computeSquareCenter(pos2keyUnsafe(pos2), asWhite, bounds));
    const validSnapDistances = validSnapCenters.map((pos2) => distanceSq(pos, pos2));
    const [, closestSnapIndex] = validSnapDistances.reduce((a, b, index) => a[0] < b ? a : [b, index], [validSnapDistances[0], 0]);
    return pos2key(validSnapPos[closestSnapIndex]);
  }
  var whitePov = (s) => s.orientation === "white";

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/fen.js
  var initial = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  var roles = {
    p: "pawn",
    r: "rook",
    n: "knight",
    b: "bishop",
    q: "queen",
    k: "king"
  };
  var letters = {
    pawn: "p",
    rook: "r",
    knight: "n",
    bishop: "b",
    queen: "q",
    king: "k"
  };
  function read(fen) {
    if (fen === "start")
      fen = initial;
    const pieces = /* @__PURE__ */ new Map();
    let row = 7, col = 0;
    for (const c of fen) {
      switch (c) {
        case " ":
        case "[":
          return pieces;
        case "/":
          --row;
          if (row < 0)
            return pieces;
          col = 0;
          break;
        case "~": {
          const k = pos2key([col - 1, row]);
          const piece = k && pieces.get(k);
          if (piece)
            piece.promoted = true;
          break;
        }
        default: {
          const nb = c.charCodeAt(0);
          if (nb < 57)
            col += nb - 48;
          else {
            const role = c.toLowerCase();
            const key = pos2key([col, row]);
            if (key)
              pieces.set(key, {
                role: roles[role],
                color: c === role ? "black" : "white"
              });
            ++col;
          }
        }
      }
    }
    return pieces;
  }
  function write(pieces) {
    return invRanks.map((y) => files.map((x) => {
      const piece = pieces.get(x + y);
      if (piece) {
        let p = letters[piece.role];
        if (piece.color === "white")
          p = p.toUpperCase();
        if (piece.promoted)
          p += "~";
        return p;
      } else
        return "1";
    }).join("")).join("/").replace(/1{2,}/g, (s) => s.length.toString());
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/config.js
  function applyAnimation(state, config) {
    if (config.animation) {
      deepMerge(state.animation, config.animation);
      if ((state.animation.duration || 0) < 70)
        state.animation.enabled = false;
    }
  }
  function configure(state, config) {
    if (config.movable?.dests)
      state.movable.dests = void 0;
    if (config.drawable?.autoShapes)
      state.drawable.autoShapes = [];
    deepMerge(state, config);
    if (config.fen) {
      state.pieces = read(config.fen);
      state.drawable.shapes = config.drawable?.shapes || [];
    }
    if ("check" in config)
      setCheck(state, config.check || false);
    if ("lastMove" in config && !config.lastMove)
      state.lastMove = void 0;
    else if (config.lastMove)
      state.lastMove = config.lastMove;
    if (state.selected)
      setSelected(state, state.selected);
    applyAnimation(state, config);
    if (!state.movable.rookCastle && state.movable.dests) {
      const rank = state.movable.color === "white" ? "1" : "8", kingStartPos = "e" + rank, dests = state.movable.dests.get(kingStartPos), king2 = state.pieces.get(kingStartPos);
      if (!dests || !king2 || king2.role !== "king")
        return;
      state.movable.dests.set(kingStartPos, dests.filter((d) => !(d === "a" + rank && dests.includes("c" + rank)) && !(d === "h" + rank && dests.includes("g" + rank))));
    }
  }
  function deepMerge(base, extend) {
    for (const key in extend) {
      if (key === "__proto__" || key === "constructor" || !Object.prototype.hasOwnProperty.call(extend, key))
        continue;
      if (Object.prototype.hasOwnProperty.call(base, key) && isPlainObject(base[key]) && isPlainObject(extend[key]))
        deepMerge(base[key], extend[key]);
      else
        base[key] = extend[key];
    }
  }
  function isPlainObject(o) {
    if (typeof o !== "object" || o === null)
      return false;
    const proto = Object.getPrototypeOf(o);
    return proto === Object.prototype || proto === null;
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/draw.js
  var brushes = ["green", "red", "blue", "yellow"];
  function start(state, e) {
    if (e.touches && e.touches.length > 1)
      return;
    e.stopPropagation();
    e.preventDefault();
    if (e.ctrlKey) {
      unselect(state);
    } else {
      cancelMove(state);
    }
    const pos = eventPosition(e), orig = getKeyAtDomPos(pos, whitePov(state), state.dom.bounds());
    if (!orig)
      return;
    state.drawable.current = {
      orig,
      pos,
      brush: eventBrush(e),
      snapToValidMove: state.drawable.defaultSnapToValidMove
    };
    processDraw(state);
  }
  function processDraw(state) {
    requestAnimationFrame(() => {
      const cur = state.drawable.current;
      if (cur) {
        const keyAtDomPos = getKeyAtDomPos(cur.pos, whitePov(state), state.dom.bounds());
        if (!keyAtDomPos) {
          cur.snapToValidMove = false;
        }
        const mouseSq = cur.snapToValidMove ? getSnappedKeyAtDomPos(cur.orig, cur.pos, whitePov(state), state.dom.bounds()) : keyAtDomPos;
        if (mouseSq !== cur.mouseSq) {
          cur.mouseSq = mouseSq;
          cur.dest = mouseSq !== cur.orig ? mouseSq : void 0;
          state.dom.redrawNow();
        }
        processDraw(state);
      }
    });
  }
  function move(state, e) {
    if (state.drawable.current)
      state.drawable.current.pos = eventPosition(e);
  }
  function end(state) {
    const cur = state.drawable.current;
    if (cur) {
      if (cur.mouseSq)
        addShape(state.drawable, cur);
      cancel(state);
    }
  }
  function cancel(state) {
    if (state.drawable.current) {
      state.drawable.current = void 0;
      state.dom.redraw();
    }
  }
  function clear(state) {
    if (state.drawable.shapes.length) {
      state.drawable.shapes = [];
      state.dom.redraw();
      onChange(state.drawable);
    }
  }
  var sameEndpoints = (s1, s2) => s1.orig === s2.orig && s1.dest === s2.dest;
  var sameColor = (s1, s2) => s1.brush === s2.brush;
  function eventBrush(e) {
    const modA = (e.shiftKey || e.ctrlKey) && isRightButton(e);
    const modB = e.altKey || e.metaKey || e.getModifierState?.("AltGraph");
    return brushes[(modA ? 1 : 0) + (modB ? 2 : 0)];
  }
  function addShape(drawable, cur) {
    const similar = drawable.shapes.find((s) => sameEndpoints(s, cur));
    if (similar)
      drawable.shapes = drawable.shapes.filter((s) => !sameEndpoints(s, cur));
    if (!similar || !sameColor(similar, cur))
      drawable.shapes.push({
        orig: cur.orig,
        dest: cur.dest,
        brush: cur.brush
      });
    onChange(drawable);
  }
  function onChange(drawable) {
    if (drawable.onChange)
      drawable.onChange(drawable.shapes);
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/drag.js
  function start2(s, e) {
    if (!(s.trustAllEvents || e.isTrusted))
      return;
    if (e.buttons !== void 0 && e.buttons > 1)
      return;
    if (e.touches && e.touches.length > 1)
      return;
    const bounds = s.dom.bounds(), position = eventPosition(e), orig = getKeyAtDomPos(position, whitePov(s), bounds);
    if (!orig)
      return;
    const piece = s.pieces.get(orig);
    const previouslySelected = s.selected;
    if (!previouslySelected && s.drawable.enabled && (s.drawable.eraseOnMovablePieceClick || !piece || piece.color !== s.turnColor))
      clear(s);
    if (e.cancelable !== false && (!e.touches || s.blockTouchScroll || piece || previouslySelected || pieceCloseTo(s, position)))
      e.preventDefault();
    else if (e.touches)
      return;
    const hadPremove = !!s.premovable.current;
    const hadPredrop = !!s.predroppable.current;
    s.stats.ctrlKey = e.ctrlKey;
    if (s.selected && canMove(s, s.selected, orig)) {
      anim((state) => selectSquare(state, orig), s);
    } else {
      selectSquare(s, orig);
    }
    const stillSelected = s.selected === orig;
    const element = pieceElementByKey(s, orig);
    if (piece && element && stillSelected && isDraggable(s, orig)) {
      s.draggable.current = {
        orig,
        piece,
        origPos: position,
        pos: position,
        started: s.draggable.autoDistance && s.stats.dragged,
        element,
        previouslySelected,
        originTarget: e.target,
        keyHasChanged: false
      };
      element.cgDragging = true;
      element.classList.add("dragging");
      const ghost = s.dom.elements.ghost;
      if (ghost) {
        ghost.className = `ghost ${piece.color} ${piece.role}`;
        translate(ghost, posToTranslate(bounds)(key2pos(orig), whitePov(s)));
        setVisible(ghost, true);
      }
      processDrag(s);
    } else {
      if (hadPremove)
        unsetPremove(s);
      if (hadPredrop)
        unsetPredrop(s);
    }
    s.dom.redraw();
  }
  function pieceCloseTo(s, pos) {
    const asWhite = whitePov(s), bounds = s.dom.bounds(), radiusSq = Math.pow(s.touchIgnoreRadius * bounds.width / 16, 2) * 2;
    for (const key of s.pieces.keys()) {
      const center = computeSquareCenter(key, asWhite, bounds);
      if (distanceSq(center, pos) <= radiusSq)
        return true;
    }
    return false;
  }
  function dragNewPiece(s, piece, e, force) {
    const key = "a0";
    s.pieces.set(key, piece);
    s.dom.redraw();
    const position = eventPosition(e);
    s.draggable.current = {
      orig: key,
      piece,
      origPos: position,
      pos: position,
      started: true,
      element: () => pieceElementByKey(s, key),
      originTarget: e.target,
      newPiece: true,
      force: !!force,
      keyHasChanged: false
    };
    processDrag(s);
  }
  function processDrag(s) {
    requestAnimationFrame(() => {
      const cur = s.draggable.current;
      if (!cur)
        return;
      if (s.animation.current?.plan.anims.has(cur.orig))
        s.animation.current = void 0;
      const origPiece = s.pieces.get(cur.orig);
      if (!origPiece || !samePiece(origPiece, cur.piece))
        cancel2(s);
      else {
        if (!cur.started && distanceSq(cur.pos, cur.origPos) >= Math.pow(s.draggable.distance, 2))
          cur.started = true;
        if (cur.started) {
          if (typeof cur.element === "function") {
            const found = cur.element();
            if (!found)
              return;
            found.cgDragging = true;
            found.classList.add("dragging");
            cur.element = found;
          }
          const bounds = s.dom.bounds();
          translate(cur.element, [
            cur.pos[0] - bounds.left - bounds.width / 16,
            cur.pos[1] - bounds.top - bounds.height / 16
          ]);
          if (s.jsHover)
            handleJsHover(s, cur);
          else
            cur.keyHasChanged || (cur.keyHasChanged = cur.orig !== getKeyAtDomPos(cur.pos, whitePov(s), bounds));
        }
      }
      processDrag(s);
    });
  }
  function handleJsHover(s, cur) {
    const hoveredKey = getKeyAtDomPos(cur.pos, whitePov(s), s.dom.bounds());
    if (cur.orig !== hoveredKey) {
      cur.keyHasChanged = true;
      if (hoveredKey) {
        const isValidMove = s.movable.dests?.get(cur.orig)?.includes(hoveredKey) ?? s.premovable.dests?.includes(hoveredKey);
        if (isValidMove) {
          const hoveredValidDestSquare = s.dom.elements.board.querySelector(`.move-dest[data-key="${hoveredKey}"], .premove-dest[data-key="${hoveredKey}"]`);
          if (hoveredValidDestSquare && !hoveredValidDestSquare.classList.contains("hover")) {
            resetHoverState(s);
            hoveredValidDestSquare.classList.add("hover");
          }
        } else {
          resetHoverState(s);
        }
      }
    } else {
      resetHoverState(s);
    }
  }
  function resetHoverState(s) {
    const squares = s.dom.elements.board.querySelectorAll(`.move-dest, .premove-dest`);
    if (squares.length > 0) {
      squares.forEach((sq) => sq.classList.remove("hover"));
    }
  }
  function move2(s, e) {
    if (s.draggable.current && (!e.touches || e.touches.length < 2)) {
      s.draggable.current.pos = eventPosition(e);
    }
  }
  function end2(s, e) {
    const cur = s.draggable.current;
    if (!cur)
      return;
    if (e.type === "touchend" && e.cancelable !== false)
      e.preventDefault();
    if (e.type === "touchend" && cur.originTarget !== e.target && !cur.newPiece) {
      s.draggable.current = void 0;
      return;
    }
    unsetPremove(s);
    unsetPredrop(s);
    const eventPos = eventPosition(e) || cur.pos;
    const dest = getKeyAtDomPos(eventPos, whitePov(s), s.dom.bounds());
    if (dest && cur.started && cur.orig !== dest) {
      if (cur.newPiece)
        dropNewPiece(s, cur.orig, dest, cur.force);
      else {
        s.stats.ctrlKey = e.ctrlKey;
        if (userMove(s, cur.orig, dest))
          s.stats.dragged = true;
      }
    } else if (cur.newPiece) {
      s.pieces.delete(cur.orig);
    } else if (s.draggable.deleteOnDropOff && !dest) {
      s.pieces.delete(cur.orig);
      callUserFunction(s.events.change);
    }
    if ((cur.orig === cur.previouslySelected || cur.keyHasChanged) && (cur.orig === dest || !dest))
      unselect(s);
    else if (!s.selectable.enabled)
      unselect(s);
    removeDragElements(s);
    s.draggable.current = void 0;
    s.dom.redraw();
  }
  function cancel2(s) {
    const cur = s.draggable.current;
    if (cur) {
      if (cur.newPiece)
        s.pieces.delete(cur.orig);
      s.draggable.current = void 0;
      unselect(s);
      removeDragElements(s);
      s.dom.redraw();
    }
  }
  function removeDragElements(s) {
    const e = s.dom.elements;
    if (e.ghost)
      setVisible(e.ghost, false);
  }
  function pieceElementByKey(s, key) {
    let el = s.dom.elements.board.firstChild;
    while (el) {
      if (el.cgKey === key && el.tagName === "PIECE")
        return el;
      el = el.nextSibling;
    }
    return void 0;
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/explosion.js
  function explosion(state, keys) {
    state.exploding = { stage: 1, keys };
    state.dom.redraw();
    setTimeout(() => {
      setStage(state, 2);
      setTimeout(() => setStage(state, void 0), 120);
    }, 120);
  }
  function setStage(state, stage) {
    if (state.exploding) {
      if (stage)
        state.exploding.stage = stage;
      else
        state.exploding = void 0;
      state.dom.redraw();
    }
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/api.js
  function start3(state, redrawAll) {
    function toggleOrientation2() {
      toggleOrientation(state);
      redrawAll();
    }
    return {
      set(config) {
        if (config.orientation && config.orientation !== state.orientation)
          toggleOrientation2();
        applyAnimation(state, config);
        (config.fen ? anim : render)((state2) => configure(state2, config), state);
      },
      state,
      getFen: () => write(state.pieces),
      toggleOrientation: toggleOrientation2,
      setPieces(pieces) {
        anim((state2) => setPieces(state2, pieces), state);
      },
      selectSquare(key, force) {
        if (key)
          anim((state2) => selectSquare(state2, key, force), state);
        else if (state.selected) {
          unselect(state);
          state.dom.redraw();
        }
      },
      move(orig, dest) {
        anim((state2) => baseMove(state2, orig, dest), state);
      },
      newPiece(piece, key) {
        anim((state2) => baseNewPiece(state2, piece, key), state);
      },
      playPremove() {
        if (state.premovable.current) {
          if (anim(playPremove, state))
            return true;
          state.dom.redraw();
        }
        return false;
      },
      playPredrop(validate) {
        if (state.predroppable.current) {
          const result = playPredrop(state, validate);
          state.dom.redraw();
          return result;
        }
        return false;
      },
      cancelPremove() {
        render(unsetPremove, state);
      },
      cancelPredrop() {
        render(unsetPredrop, state);
      },
      cancelMove() {
        render((state2) => {
          cancelMove(state2);
          cancel2(state2);
        }, state);
      },
      stop() {
        render((state2) => {
          stop(state2);
          cancel2(state2);
        }, state);
      },
      explode(keys) {
        explosion(state, keys);
      },
      setAutoShapes(shapes) {
        render((state2) => state2.drawable.autoShapes = shapes, state);
      },
      setShapes(shapes) {
        render((state2) => state2.drawable.shapes = shapes.slice(), state);
      },
      getKeyAtDomPos(pos) {
        return getKeyAtDomPos(pos, whitePov(state), state.dom.bounds());
      },
      redrawAll,
      dragNewPiece(piece, event, force) {
        dragNewPiece(state, piece, event, force);
      },
      destroy() {
        stop(state);
        state.dom.unbind?.();
        state.dom.destroyed = true;
      }
    };
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/sync.js
  function syncShapes(shapes, root, renderShape3) {
    const hashesInDom = /* @__PURE__ */ new Map(), toRemove = [];
    for (const sc of shapes)
      hashesInDom.set(sc.hash, false);
    let el = root.firstElementChild, elHash;
    while (el) {
      elHash = el.getAttribute("cgHash");
      if (hashesInDom.has(elHash))
        hashesInDom.set(elHash, true);
      else
        toRemove.push(el);
      el = el.nextElementSibling;
    }
    for (const el2 of toRemove)
      root.removeChild(el2);
    for (const sc of shapes) {
      if (!hashesInDom.get(sc.hash))
        root.appendChild(renderShape3(sc));
    }
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/autoPieces.js
  function render2(state, autoPieceEl) {
    const autoPieces = state.drawable.autoShapes.filter((autoShape) => autoShape.piece);
    const autoPieceShapes = autoPieces.map((s) => {
      return {
        shape: s,
        hash: hash(s),
        current: false,
        pendingErase: false
      };
    });
    syncShapes(autoPieceShapes, autoPieceEl, (shape) => renderShape(state, shape, state.dom.bounds()));
  }
  function renderResized(state) {
    const asWhite = whitePov(state), posToTranslate2 = posToTranslate(state.dom.bounds());
    let el = state.dom.elements.autoPieces?.firstChild;
    while (el) {
      translateAndScale(el, posToTranslate2(key2pos(el.cgKey), asWhite), el.cgScale);
      el = el.nextSibling;
    }
  }
  function renderShape(state, { shape, hash: hash2 }, bounds) {
    const orig = shape.orig;
    const role = shape.piece?.role;
    const color = shape.piece?.color;
    const scale = shape.piece?.scale;
    const pieceEl = createEl("piece", `${role} ${color}`);
    pieceEl.setAttribute("cgHash", hash2);
    pieceEl.cgKey = orig;
    pieceEl.cgScale = scale;
    translateAndScale(pieceEl, posToTranslate(bounds)(key2pos(orig), whitePov(state)), scale);
    return pieceEl;
  }
  var hash = (autoPiece) => [autoPiece.orig, autoPiece.piece?.role, autoPiece.piece?.color, autoPiece.piece?.scale].join(",");

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/drop.js
  function drop(s, e) {
    if (!s.dropmode.active)
      return;
    unsetPremove(s);
    unsetPredrop(s);
    const piece = s.dropmode.piece;
    if (piece) {
      s.pieces.set("a0", piece);
      const position = eventPosition(e);
      const dest = position && getKeyAtDomPos(position, whitePov(s), s.dom.bounds());
      if (dest)
        dropNewPiece(s, "a0", dest);
    }
    s.dom.redraw();
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/events.js
  function bindBoard(s) {
    const boardEl = s.dom.elements.board;
    if (s.disableContextMenu || s.drawable.enabled) {
      boardEl.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    if (s.viewOnly)
      return;
    const onStart = startDragOrDraw(s);
    boardEl.addEventListener("touchstart", onStart, {
      passive: false
    });
    boardEl.addEventListener("mousedown", onStart, {
      passive: false
    });
  }
  function bindDocument(s, onResize) {
    const unbinds = [];
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(onResize);
      ro.observe(s.dom.elements.wrap);
      unbinds.push(() => ro.disconnect());
    } else
      unbinds.push(unbindable(document.body, "chessground.resize", onResize));
    if (!s.viewOnly) {
      const onmove = dragOrDraw(s, move2, move);
      const onend = dragOrDraw(s, end2, end);
      for (const ev of ["touchmove", "mousemove"])
        unbinds.push(unbindable(document, ev, onmove));
      for (const ev of ["touchend", "mouseup"])
        unbinds.push(unbindable(document, ev, onend));
      const onScroll = () => s.dom.bounds.clear();
      unbinds.push(unbindable(document, "scroll", onScroll, { capture: true, passive: true }));
      unbinds.push(unbindable(window, "resize", onScroll, { passive: true }));
    }
    return () => unbinds.forEach((f) => f());
  }
  function unbindable(el, eventName, callback, options) {
    el.addEventListener(eventName, callback, options);
    return () => el.removeEventListener(eventName, callback, options);
  }
  var startDragOrDraw = (s) => (e) => {
    if (s.draggable.current)
      cancel2(s);
    else if (s.drawable.current)
      cancel(s);
    else if (e.shiftKey || isRightButton(e)) {
      if (s.drawable.enabled)
        start(s, e);
    } else if (!s.viewOnly) {
      if (s.dropmode.active)
        drop(s, e);
      else
        start2(s, e);
    }
  };
  var dragOrDraw = (s, withDrag, withDraw) => (e) => {
    if (s.drawable.current) {
      if (s.drawable.enabled)
        withDraw(s, e);
    } else if (!s.viewOnly)
      withDrag(s, e);
  };

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/render.js
  function render3(s) {
    const asWhite = whitePov(s), posToTranslate2 = posToTranslate(s.dom.bounds()), boardEl = s.dom.elements.board, pieces = s.pieces, curAnim = s.animation.current, anims = curAnim ? curAnim.plan.anims : /* @__PURE__ */ new Map(), fadings = curAnim ? curAnim.plan.fadings : /* @__PURE__ */ new Map(), curDrag = s.draggable.current, samePieces = /* @__PURE__ */ new Set(), movedPieces = /* @__PURE__ */ new Map(), desiredSquares = computeSquareClasses(s), availableSquares = /* @__PURE__ */ new Map();
    let k, el, pieceAtKey, elPieceName, anim2, fading, pMvdset, pMvd, sAvail;
    el = boardEl.firstChild;
    while (el) {
      k = el.cgKey;
      if (isPieceNode(el)) {
        pieceAtKey = pieces.get(k);
        anim2 = anims.get(k);
        fading = fadings.get(k);
        elPieceName = el.cgPiece;
        if (el.cgDragging && (!curDrag || curDrag.orig !== k)) {
          el.classList.remove("dragging");
          translate(el, posToTranslate2(key2pos(k), asWhite));
          el.cgDragging = false;
        }
        if (!fading && el.cgFading) {
          el.cgFading = false;
          el.classList.remove("fading");
        }
        if (pieceAtKey) {
          if (anim2 && el.cgAnimating && elPieceName === pieceNameOf(pieceAtKey)) {
            const pos = key2pos(k);
            pos[0] += anim2[2];
            pos[1] += anim2[3];
            el.classList.add("anim");
            translate(el, posToTranslate2(pos, asWhite));
          } else if (el.cgAnimating) {
            el.cgAnimating = false;
            el.classList.remove("anim");
            translate(el, posToTranslate2(key2pos(k), asWhite));
            if (s.addPieceZIndex)
              el.style.zIndex = posZIndex(key2pos(k), asWhite);
          }
          if (elPieceName === pieceNameOf(pieceAtKey) && (!fading || !el.cgFading))
            samePieces.add(k);
          else if (fading && elPieceName === pieceNameOf(fading)) {
            el.classList.add("fading");
            el.cgFading = true;
          } else
            appendValue(movedPieces, elPieceName, el);
        } else
          appendValue(movedPieces, elPieceName, el);
      } else if (isSquareNode(el)) {
        const cls = el.className;
        if (desiredSquares.get(k) === cls) {
          setVisible(el, true);
          desiredSquares.delete(k);
        } else
          appendValue(availableSquares, cls, el);
      }
      el = el.nextSibling;
    }
    for (const [sk, className] of desiredSquares) {
      sAvail = availableSquares.get(className)?.pop();
      const translation = posToTranslate2(key2pos(sk), asWhite);
      if (sAvail) {
        sAvail.cgKey = sk;
        if (s.jsHover)
          sAvail.dataset["key"] = sk;
        translate(sAvail, translation);
        setVisible(sAvail, true);
      } else {
        const squareNode = createEl("square", className);
        squareNode.cgKey = sk;
        if (s.jsHover)
          squareNode.dataset["key"] = sk;
        translate(squareNode, translation);
        boardEl.insertBefore(squareNode, boardEl.firstChild);
      }
    }
    for (const [, nodes] of availableSquares.entries()) {
      for (const node of nodes)
        setVisible(node, false);
    }
    for (const [k2, p] of pieces) {
      anim2 = anims.get(k2);
      if (!samePieces.has(k2)) {
        pMvdset = movedPieces.get(pieceNameOf(p));
        pMvd = pMvdset && pMvdset.pop();
        if (pMvd) {
          pMvd.cgKey = k2;
          if (pMvd.cgFading) {
            pMvd.classList.remove("fading");
            pMvd.cgFading = false;
          }
          const pos = key2pos(k2);
          if (s.addPieceZIndex)
            pMvd.style.zIndex = posZIndex(pos, asWhite);
          if (anim2) {
            pMvd.cgAnimating = true;
            pMvd.classList.add("anim");
            pos[0] += anim2[2];
            pos[1] += anim2[3];
          }
          translate(pMvd, posToTranslate2(pos, asWhite));
        } else {
          const pieceName = pieceNameOf(p), pieceNode = createEl("piece", pieceName), pos = key2pos(k2);
          pieceNode.cgPiece = pieceName;
          pieceNode.cgKey = k2;
          if (anim2) {
            pieceNode.cgAnimating = true;
            pos[0] += anim2[2];
            pos[1] += anim2[3];
          }
          translate(pieceNode, posToTranslate2(pos, asWhite));
          if (s.addPieceZIndex)
            pieceNode.style.zIndex = posZIndex(pos, asWhite);
          boardEl.appendChild(pieceNode);
        }
      }
    }
    for (const nodes of movedPieces.values())
      removeNodes(s, nodes);
  }
  function renderResized2(s) {
    const asWhite = whitePov(s), posToTranslate2 = posToTranslate(s.dom.bounds());
    let el = s.dom.elements.board.firstChild;
    while (el) {
      if (isPieceNode(el) && !el.cgAnimating || isSquareNode(el)) {
        translate(el, posToTranslate2(key2pos(el.cgKey), asWhite));
      }
      el = el.nextSibling;
    }
  }
  function updateBounds(s) {
    const bounds = s.dom.elements.wrap.getBoundingClientRect();
    const container = s.dom.elements.container;
    const ratio = bounds.height / bounds.width;
    const width = Math.floor(bounds.width * window.devicePixelRatio / 8) * 8 / window.devicePixelRatio;
    const height = width * ratio;
    container.style.width = width + "px";
    container.style.height = height + "px";
    s.dom.bounds.clear();
    s.addDimensionsCssVarsTo?.style.setProperty("---cg-width", width + "px");
    s.addDimensionsCssVarsTo?.style.setProperty("---cg-height", height + "px");
  }
  var isPieceNode = (el) => el.tagName === "PIECE";
  var isSquareNode = (el) => el.tagName === "SQUARE";
  function removeNodes(s, nodes) {
    for (const node of nodes)
      s.dom.elements.board.removeChild(node);
  }
  function posZIndex(pos, asWhite) {
    const minZ = 3;
    const rank = pos[1];
    const z = asWhite ? minZ + 7 - rank : minZ + rank;
    return `${z}`;
  }
  var pieceNameOf = (piece) => `${piece.color} ${piece.role}`;
  var normalizeLastMoveStandardRookCastle = (s, k) => !!s.lastMove?.[1] && !s.pieces.has(s.lastMove[1]) && s.lastMove[0][0] === "e" && ["h", "a"].includes(s.lastMove[1][0]) && s.lastMove[0][1] === s.lastMove[1][1] && squaresBetween(...key2pos(s.lastMove[0]), ...key2pos(s.lastMove[1])).some((sq) => s.pieces.has(sq)) ? (k > s.lastMove[0] ? "g" : "c") + k[1] : k;
  function computeSquareClasses(s) {
    const squares = /* @__PURE__ */ new Map();
    if (s.lastMove && s.highlight.lastMove)
      for (const [i, k] of s.lastMove.entries())
        addSquare(squares, i === 1 ? normalizeLastMoveStandardRookCastle(s, k) : k, "last-move");
    if (s.check && s.highlight.check)
      addSquare(squares, s.check, "check");
    if (s.selected) {
      addSquare(squares, s.selected, "selected");
      if (s.movable.showDests) {
        for (const k of s.movable.dests?.get(s.selected) ?? [])
          addSquare(squares, k, "move-dest" + (s.pieces.has(k) ? " oc" : ""));
        for (const k of s.premovable.customDests?.get(s.selected) ?? s.premovable.dests ?? [])
          addSquare(squares, k, "premove-dest" + (s.pieces.has(k) ? " oc" : ""));
      }
    }
    const premove2 = s.premovable.current;
    if (premove2)
      for (const k of premove2)
        addSquare(squares, k, "current-premove");
    else if (s.predroppable.current)
      addSquare(squares, s.predroppable.current.key, "current-premove");
    const o = s.exploding;
    if (o)
      for (const k of o.keys)
        addSquare(squares, k, "exploding" + o.stage);
    if (s.highlight.custom) {
      s.highlight.custom.forEach((v, k) => {
        addSquare(squares, k, v);
      });
    }
    return squares;
  }
  function addSquare(squares, key, klass) {
    const classes = squares.get(key);
    if (classes)
      squares.set(key, `${classes} ${klass}`);
    else
      squares.set(key, klass);
  }
  function appendValue(map, key, value) {
    const arr = map.get(key);
    if (arr)
      arr.push(value);
    else
      map.set(key, [value]);
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/state.js
  function defaults() {
    return {
      pieces: read(initial),
      orientation: "white",
      turnColor: "white",
      coordinates: true,
      coordinatesOnSquares: false,
      ranksPosition: "right",
      autoCastle: true,
      viewOnly: false,
      disableContextMenu: false,
      addPieceZIndex: false,
      blockTouchScroll: false,
      touchIgnoreRadius: 1,
      pieceKey: false,
      trustAllEvents: false,
      jsHover: false,
      highlight: {
        lastMove: true,
        check: true
      },
      animation: {
        enabled: true,
        duration: 200
      },
      movable: {
        free: true,
        color: "both",
        showDests: true,
        events: {},
        rookCastle: true
      },
      premovable: {
        enabled: true,
        showDests: true,
        castle: true,
        additionalPremoveRequirements: (_) => true,
        events: {}
      },
      predroppable: {
        enabled: false,
        events: {}
      },
      draggable: {
        enabled: true,
        distance: 3,
        autoDistance: true,
        showGhost: true,
        deleteOnDropOff: false
      },
      dropmode: {
        active: false
      },
      selectable: {
        enabled: true
      },
      stats: {
        // on touchscreen, default to "tap-tap" moves
        // instead of drag
        dragged: !("ontouchstart" in window)
      },
      events: {},
      drawable: {
        enabled: true,
        // can draw
        visible: true,
        // can view
        defaultSnapToValidMove: true,
        eraseOnMovablePieceClick: true,
        shapes: [],
        autoShapes: [],
        brushes: {
          green: { key: "g", color: "#15781B", opacity: 1, lineWidth: 10 },
          red: { key: "r", color: "#882020", opacity: 1, lineWidth: 10 },
          blue: { key: "b", color: "#003088", opacity: 1, lineWidth: 10 },
          yellow: { key: "y", color: "#e68f00", opacity: 1, lineWidth: 10 },
          paleBlue: { key: "pb", color: "#003088", opacity: 0.4, lineWidth: 15 },
          paleGreen: { key: "pg", color: "#15781B", opacity: 0.4, lineWidth: 15 },
          paleRed: { key: "pr", color: "#882020", opacity: 0.4, lineWidth: 15 },
          paleGrey: {
            key: "pgr",
            color: "#4a4a4a",
            opacity: 0.35,
            lineWidth: 15
          },
          purple: { key: "purple", color: "#68217a", opacity: 0.65, lineWidth: 10 },
          pink: { key: "pink", color: "#ee2080", opacity: 0.5, lineWidth: 10 },
          white: { key: "white", color: "white", opacity: 1, lineWidth: 10 },
          paleWhite: { key: "pwhite", color: "white", opacity: 0.6, lineWidth: 10 },
          variation: { key: "variation", color: "white", opacity: 0.5, lineWidth: 12 }
        },
        prevSvgHash: ""
      },
      hold: timer()
    };
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/svg.js
  function createDefs() {
    const defs = createElement("defs");
    const filter = setAttributes(createElement("filter"), { id: "cg-filter-blur" });
    filter.appendChild(setAttributes(createElement("feGaussianBlur"), { stdDeviation: "0.013" }));
    defs.appendChild(filter);
    return defs;
  }
  function renderSvg(state, els) {
    const d = state.drawable, curD = d.current, cur = curD && curD.mouseSq ? curD : void 0, dests = /* @__PURE__ */ new Map(), bounds = state.dom.bounds(), nonPieceAutoShapes = d.autoShapes.filter((autoShape) => !autoShape.piece);
    for (const s of d.shapes.concat(nonPieceAutoShapes).concat(cur ? [cur] : [])) {
      if (!s.dest)
        continue;
      const sources = dests.get(s.dest) ?? /* @__PURE__ */ new Set(), from = pos2user(orient(key2pos(s.orig), state.orientation), bounds), to = pos2user(orient(key2pos(s.dest), state.orientation), bounds);
      sources.add(angleToSlot(moveAngle(from, to)));
      dests.set(s.dest, sources);
    }
    const shapes = [];
    const pendingEraseIdx = cur ? d.shapes.findIndex((s) => sameEndpoints(s, cur) && sameColor(s, cur)) : -1;
    for (const [idx, s] of d.shapes.concat(nonPieceAutoShapes).entries()) {
      const isPendingErase = pendingEraseIdx !== -1 && pendingEraseIdx === idx;
      shapes.push({
        shape: s,
        current: false,
        pendingErase: isPendingErase,
        hash: shapeHash(s, isShort(s.dest, dests), false, bounds, isPendingErase, angleCount(s.dest, dests))
      });
    }
    if (cur && pendingEraseIdx === -1)
      shapes.push({
        shape: cur,
        current: true,
        hash: shapeHash(cur, isShort(cur.dest, dests), true, bounds, false, angleCount(cur.dest, dests)),
        pendingErase: false
      });
    const fullHash = shapes.map((sc) => sc.hash).join(";");
    if (fullHash === state.drawable.prevSvgHash)
      return;
    state.drawable.prevSvgHash = fullHash;
    syncDefs(d, shapes, els);
    syncShapes2(shapes, els, (s) => renderShape2(state, s, d.brushes, dests, bounds));
  }
  function syncDefs(d, shapes, els) {
    for (const shapesEl of [els.shapes, els.shapesBelow]) {
      const defsEl = shapesEl.querySelector("defs");
      const thisPlane = shapes.filter((s) => shapesEl === els.shapesBelow === !!s.shape.below);
      const brushes2 = /* @__PURE__ */ new Map();
      for (const s of thisPlane.filter((s2) => s2.shape.dest && s2.shape.brush)) {
        const brush = makeCustomBrush(d.brushes[s.shape.brush], s.shape.modifiers);
        const { key, color } = hiliteOf(s.shape);
        if (key && color)
          brushes2.set(key, { key, color, opacity: 1, lineWidth: 1 });
        brushes2.set(brush.key, brush);
      }
      const keysInDom = /* @__PURE__ */ new Set();
      let el = defsEl.firstElementChild;
      while (el) {
        keysInDom.add(el.getAttribute("cgKey"));
        el = el.nextElementSibling;
      }
      for (const [key, brush] of brushes2.entries()) {
        if (!keysInDom.has(key))
          defsEl.appendChild(renderMarker(brush));
      }
    }
  }
  function syncShapes2(shapes, els, renderShape3) {
    for (const [shapesEl, customEl] of [
      [els.shapes, els.custom],
      [els.shapesBelow, els.customBelow]
    ]) {
      const [shapesG, customG] = [shapesEl, customEl].map((el) => el.querySelector("g"));
      const thisPlane = shapes.filter((s) => shapesEl === els.shapesBelow === !!s.shape.below);
      const hashesInDom = /* @__PURE__ */ new Map();
      for (const sc of thisPlane)
        hashesInDom.set(sc.hash, false);
      for (const root of [shapesG, customG]) {
        const toRemove = [];
        let el = root.firstElementChild, elHash;
        while (el) {
          elHash = el.getAttribute("cgHash");
          if (hashesInDom.has(elHash))
            hashesInDom.set(elHash, true);
          else
            toRemove.push(el);
          el = el.nextElementSibling;
        }
        for (const el2 of toRemove)
          root.removeChild(el2);
      }
      for (const sc of thisPlane.filter((s) => !hashesInDom.get(s.hash))) {
        for (const svg of renderShape3(sc)) {
          if (svg.isCustom)
            customG.appendChild(svg.el);
          else
            shapesG.appendChild(svg.el);
        }
      }
    }
  }
  function shapeHash({ orig, dest, brush, piece, modifiers, customSvg, label, below }, shorten, current, bounds, pendingErase, angleCountOfDest) {
    return [
      bounds.width,
      bounds.height,
      current,
      pendingErase && "pendingErase",
      angleCountOfDest,
      orig,
      dest,
      brush,
      shorten && "-",
      piece && pieceHash(piece),
      modifiers && modifiersHash(modifiers),
      customSvg && `custom-${textHash(customSvg.html)},${customSvg.center?.[0] ?? "o"}`,
      label && `label-${textHash(label.text)}`,
      below && "below"
    ].filter(Boolean).join(",");
  }
  var pieceHash = (piece) => [piece.color, piece.role, piece.scale].filter(Boolean).join(",");
  var modifiersHash = (m) => [m.lineWidth, m.hilite].filter(Boolean).join(",");
  function textHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i) >>> 0;
    }
    return h.toString();
  }
  function renderShape2(state, { shape, current, pendingErase, hash: hash2 }, brushes2, dests, bounds) {
    const from = pos2user(orient(key2pos(shape.orig), state.orientation), bounds), to = shape.dest ? pos2user(orient(key2pos(shape.dest), state.orientation), bounds) : from, brush = shape.brush && makeCustomBrush(brushes2[shape.brush], shape.modifiers), slots = dests.get(shape.dest), svgs = [];
    if (brush) {
      const el = setAttributes(createElement("g"), { cgHash: hash2 });
      svgs.push({ el });
      if (from[0] !== to[0] || from[1] !== to[1])
        el.appendChild(renderArrow(shape, brush, from, to, current, isShort(shape.dest, dests), pendingErase));
      else
        el.appendChild(renderCircle(brushes2[shape.brush], from, current, bounds, pendingErase, shape.modifiers?.hilite));
    }
    if (shape.label) {
      const label = shape.label;
      label.fill ?? (label.fill = shape.brush && brushes2[shape.brush].color);
      const corner = shape.brush ? void 0 : "tr";
      svgs.push({ el: renderLabel(label, hash2, from, to, slots, corner), isCustom: true });
    }
    if (shape.customSvg) {
      const on = shape.customSvg.center ?? "orig";
      const [x, y] = on === "label" ? labelCoords(from, to, slots).map((c) => c - 0.5) : on === "dest" ? to : from;
      const el = setAttributes(createElement("g"), { transform: `translate(${x},${y})`, cgHash: hash2 });
      el.innerHTML = `<svg width="1" height="1" viewBox="0 0 100 100">${shape.customSvg.html}</svg>`;
      svgs.push({ el, isCustom: true });
    }
    return svgs;
  }
  function renderCircle(brush, at, current, bounds, pendingErase, hiliteColor) {
    const widths = circleWidth(), radius = (bounds.width + bounds.height) / (4 * Math.max(bounds.width, bounds.height));
    function renderOneCircle(isHilite) {
      return setAttributes(createElement("circle"), {
        stroke: isHilite ? hiliteColor : brush.color,
        "stroke-width": widths[current ? 0 : 1] * (isHilite ? 2 : 1),
        fill: "none",
        opacity: hiliteColor && !pendingErase ? 1 : opacity(brush, current, pendingErase),
        cx: at[0],
        cy: at[1],
        r: radius - widths[1] / 2
      });
    }
    if (!hiliteColor)
      return renderOneCircle(false);
    const g = setAttributes(createElement("g"), { opacity: brush.opacity });
    const blurred = setAttributes(createElement("g"), { filter: "url(#cg-filter-blur)" });
    blurred.appendChild(renderOneCircle(true));
    g.appendChild(blurred);
    g.appendChild(renderOneCircle(false));
    return g;
  }
  function renderArrow(s, brush, from, to, current, shorten, pendingErase) {
    function renderLine(isHilite) {
      const m = arrowMargin(shorten && !current), dx = to[0] - from[0], dy = to[1] - from[1], angle = Math.atan2(dy, dx), xo = Math.cos(angle) * m, yo = Math.sin(angle) * m;
      const hilite = hiliteOf(s);
      return setAttributes(createElement("line"), {
        stroke: isHilite ? hilite.color : brush.color,
        "stroke-width": lineWidth(brush, current) * (isHilite ? 1.14 : 1),
        "stroke-linecap": "round",
        "marker-end": `url(#arrowhead-${isHilite ? hilite.key : brush.key})`,
        opacity: s.modifiers?.hilite && !pendingErase ? 1 : opacity(brush, current, pendingErase),
        x1: from[0],
        y1: from[1],
        x2: to[0] - xo,
        y2: to[1] - yo
      });
    }
    if (!s.modifiers?.hilite)
      return renderLine(false);
    const g = setAttributes(createElement("g"), { opacity: brush.opacity });
    const blurred = setAttributes(createElement("g"), { filter: "url(#cg-filter-blur)" });
    blurred.appendChild(filterBox(from, to));
    blurred.appendChild(renderLine(true));
    g.appendChild(blurred);
    g.appendChild(renderLine(false));
    return g;
  }
  function renderMarker(brush) {
    const marker = setAttributes(createElement("marker"), {
      id: "arrowhead-" + brush.key,
      orient: "auto",
      overflow: "visible",
      markerWidth: 4,
      markerHeight: 4,
      refX: brush.key.startsWith("hilite") ? 1.86 : 2.05,
      refY: 2
    });
    marker.appendChild(setAttributes(createElement("path"), {
      d: "M0,0 V4 L3,2 Z",
      fill: brush.color
    }));
    marker.setAttribute("cgKey", brush.key);
    return marker;
  }
  function renderLabel(label, hash2, from, to, slots, corner) {
    const labelSize = 0.4, fontSize = labelSize * 0.75 ** label.text.length, at = labelCoords(from, to, slots), cornerOff = corner === "tr" ? 0.4 : 0, g = setAttributes(createElement("g"), {
      transform: `translate(${at[0] + cornerOff},${at[1] - cornerOff})`,
      cgHash: hash2
    });
    g.appendChild(setAttributes(createElement("circle"), {
      r: labelSize / 2,
      "fill-opacity": corner ? 1 : 0.8,
      "stroke-opacity": corner ? 1 : 0.7,
      "stroke-width": 0.03,
      fill: label.fill ?? "#666",
      stroke: "white"
    }));
    const labelEl = setAttributes(createElement("text"), {
      "font-size": fontSize,
      "font-family": "Noto Sans",
      "text-anchor": "middle",
      fill: "white",
      y: 0.13 * 0.75 ** label.text.length
    });
    labelEl.innerHTML = label.text;
    g.appendChild(labelEl);
    return g;
  }
  var orient = (pos, color) => color === "white" ? pos : [7 - pos[0], 7 - pos[1]];
  var mod = (n, m) => (n % m + m) % m;
  var rotateAngleSlot = (slot, steps) => mod(slot + steps, 16);
  var anyTwoCloserThan90Degrees = (slots) => [...slots].some((slot) => [-3, -2, -1, 1, 2, 3].some((i) => slots.has(rotateAngleSlot(slot, i))));
  var isShort = (dest, dests) => !!dest && dests.has(dest) && anyTwoCloserThan90Degrees(dests.get(dest));
  var createElement = (tagName) => document.createElementNS("http://www.w3.org/2000/svg", tagName);
  var angleCount = (dest, dests) => dest && dests.has(dest) ? dests.get(dest).size : 0;
  function setAttributes(el, attrs) {
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key))
        el.setAttribute(key, attrs[key]);
    }
    return el;
  }
  var makeCustomBrush = (base, modifiers) => !modifiers ? base : {
    color: base.color,
    opacity: Math.round(base.opacity * 10) / 10,
    lineWidth: Math.round(modifiers.lineWidth || base.lineWidth),
    key: [base.key, modifiers.lineWidth].filter(Boolean).join("")
  };
  var circleWidth = () => [3 / 64, 4 / 64];
  var lineWidth = (brush, current) => (brush.lineWidth || 10) * (current ? 0.85 : 1) / 64;
  function hiliteOf(shape) {
    const hilite = shape.modifiers?.hilite;
    return { key: hilite && `hilite-${hilite.replace("#", "")}`, color: hilite };
  }
  var opacity = (brush, current, pendingErase) => (brush.opacity || 1) * (pendingErase ? 0.6 : current ? 0.9 : 1);
  var arrowMargin = (shorten) => (shorten ? 20 : 10) / 64;
  function pos2user(pos, bounds) {
    const xScale = Math.min(1, bounds.width / bounds.height);
    const yScale = Math.min(1, bounds.height / bounds.width);
    return [(pos[0] - 3.5) * xScale, (3.5 - pos[1]) * yScale];
  }
  function filterBox(from, to) {
    const box = {
      from: [Math.floor(Math.min(from[0], to[0])), Math.floor(Math.min(from[1], to[1]))],
      to: [Math.ceil(Math.max(from[0], to[0])), Math.ceil(Math.max(from[1], to[1]))]
    };
    return setAttributes(createElement("rect"), {
      x: box.from[0],
      y: box.from[1],
      width: box.to[0] - box.from[0],
      height: box.to[1] - box.from[1],
      fill: "none",
      stroke: "none"
    });
  }
  var angleToSlot = (angle) => mod(Math.round(angle * 8 / Math.PI), 16);
  var moveAngle = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]) + Math.PI;
  var dist = (from, to) => Math.sqrt([from[0] - to[0], from[1] - to[1]].reduce((acc, x) => acc + x * x, 0));
  function labelCoords(from, to, slots) {
    let mag = dist(from, to);
    const angle = moveAngle(from, to);
    if (slots) {
      mag -= 33 / 64;
      if (anyTwoCloserThan90Degrees(slots)) {
        mag -= 10 / 64;
        const slot = angleToSlot(angle);
        if (slot & 1 && [-1, 1].some((s) => slots.has(rotateAngleSlot(slot, s))))
          mag -= 0.4;
      }
    }
    return [from[0] - Math.cos(angle) * mag, from[1] - Math.sin(angle) * mag].map((c) => c + 0.5);
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/wrap.js
  function renderWrap(element, s) {
    element.innerHTML = "";
    element.classList.add("cg-wrap");
    for (const c of colors)
      element.classList.toggle("orientation-" + c, s.orientation === c);
    element.classList.toggle("manipulable", !s.viewOnly);
    const container = createEl("cg-container");
    element.appendChild(container);
    const board = createEl("cg-board");
    container.appendChild(board);
    let shapesBelow;
    let shapes;
    let customBelow;
    let custom;
    let autoPieces;
    if (s.drawable.visible) {
      [shapesBelow, shapes] = ["cg-shapes-below", "cg-shapes"].map((cls) => svgContainer(cls, true));
      [customBelow, custom] = ["cg-custom-below", "cg-custom-svgs"].map((cls) => svgContainer(cls, false));
      autoPieces = createEl("cg-auto-pieces");
      container.appendChild(shapesBelow);
      container.appendChild(customBelow);
      container.appendChild(shapes);
      container.appendChild(custom);
      container.appendChild(autoPieces);
    }
    if (s.coordinates) {
      const orientClass = s.orientation === "black" ? " black" : "";
      const ranksPositionClass = s.ranksPosition === "left" ? " left" : "";
      if (s.coordinatesOnSquares) {
        const rankN = s.orientation === "white" ? (i) => i + 1 : (i) => 8 - i;
        files.forEach((f, i) => container.appendChild(renderCoords(ranks.map((r) => f + r), "squares rank" + rankN(i) + orientClass + ranksPositionClass, i % 2 === 0 ? "black" : "white")));
      } else {
        container.appendChild(renderCoords(ranks, "ranks" + orientClass + ranksPositionClass, s.ranksPosition === "right" === (s.orientation === "white") ? "white" : "black"));
        container.appendChild(renderCoords(files, "files" + orientClass, opposite(s.orientation)));
      }
    }
    let ghost;
    if (!s.viewOnly && s.draggable.enabled && s.draggable.showGhost) {
      ghost = createEl("piece", "ghost");
      setVisible(ghost, false);
      container.appendChild(ghost);
    }
    return { board, container, wrap: element, ghost, shapes, shapesBelow, custom, customBelow, autoPieces };
  }
  function svgContainer(cls, isShapes) {
    const svg = setAttributes(createElement("svg"), {
      class: cls,
      viewBox: isShapes ? "-4 -4 8 8" : "-3.5 -3.5 8 8",
      preserveAspectRatio: "xMidYMid slice",
      style: "color-scheme:light only"
    });
    if (isShapes)
      svg.appendChild(createDefs());
    svg.appendChild(createElement("g"));
    return svg;
  }
  function renderCoords(elems, className, firstColor) {
    const el = createEl("coords", className);
    let f;
    elems.forEach((elem, i) => {
      const light = i % 2 === (firstColor === "white" ? 0 : 1);
      f = createEl("coord", `coord-${light ? "light" : "dark"}`);
      f.textContent = elem;
      el.appendChild(f);
    });
    return el;
  }

  // ../../../../../tmp/chiko-chess-deps/ground/package/dist/chessground.js
  function initModule({ el, config }) {
    return Chessground(el, config);
  }
  function Chessground(element, config) {
    const maybeState = defaults();
    configure(maybeState, config || {});
    function redrawAll() {
      const prevUnbind = "dom" in maybeState ? maybeState.dom.unbind : void 0;
      const elements = renderWrap(element, maybeState), bounds = memo(() => elements.board.getBoundingClientRect()), redrawNow = (skipSvg) => {
        render3(state);
        if (elements.autoPieces)
          render2(state, elements.autoPieces);
        if (!skipSvg && elements.shapes)
          renderSvg(state, elements);
      }, onResize = () => {
        updateBounds(state);
        renderResized2(state);
        if (elements.autoPieces)
          renderResized(state);
      };
      const state = maybeState;
      state.dom = {
        elements,
        bounds,
        redraw: debounceRedraw(redrawNow),
        redrawNow,
        unbind: prevUnbind
      };
      state.drawable.prevSvgHash = "";
      updateBounds(state);
      redrawNow(false);
      bindBoard(state);
      if (!prevUnbind)
        state.dom.unbind = bindDocument(state, onResize);
      state.events.insert?.(elements);
      return state;
    }
    return start3(redrawAll(), redrawAll);
  }
  function debounceRedraw(redrawNow) {
    let redrawing = false;
    return () => {
      if (redrawing)
        return;
      redrawing = true;
      requestAnimationFrame(() => {
        redrawNow();
        redrawing = false;
      });
    };
  }
  return __toCommonJS(chessground_exports);
})();
