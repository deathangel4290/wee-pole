'use strict';

/*
 * Pip, the coach. A little character who reacts to your games in a speech bubble:
 * cheers good moves, softens bad ones, points you to hints and reviews.
 *
 * The lines are written here and chosen from what's actually happening in the game
 * (engine-rated move quality, results, streaks), so Pip works fully offline and free.
 *
 *   const pip = BB.coach.create();  container.append(pip.el);
 *   pip.react('best')  pip.react('win')  pip.say('Custom line', 'happy')
 */
BB.coach = (() => {
  const { el } = BB;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // event -> [mood, lines, priority]. High priority always speaks; low only now and then.
  const EVENTS = {
    start: ['happy', [
      'Let’s go! I’ll be right here.',
      'Good luck, have fun! 🍀',
      'Ready when you are.',
      'Fresh game, fresh chances.',
    ], 'high'],
    best: ['excited', [
      'Engine-approved move! 👌',
      'That’s exactly what I’d play.',
      'Sharp! 🔪',
      'Textbook.',
      'Ooh, nice find!',
    ], 'low'],
    good: ['happy', [
      'Solid move.',
      'Nice and steady.',
      'Good thinking.',
    ], 'low'],
    inaccuracy: ['thinking', [
      'Hmm, there was something a little better there.',
      'Not bad, but not the best either. 🤔',
    ], 'low'],
    mistake: ['worried', [
      'Careful, that gives them a chance.',
      'Hmm… I think they can punish that.',
      'Watch out! That one has a weak spot.',
    ], 'high'],
    blunder: ['worried', [
      'Oof. Deep breath, it happens to everyone.',
      'That one stings. Want a 💡 hint next move?',
      'Uh-oh. Let’s see if we can fight back!',
    ], 'high'],
    comeback: ['excited', [
      'What a comeback! 🔥',
      'You’re back in this!',
    ], 'high'],
    hint: ['thinking', [
      'Here’s what I’d look at 💡',
      'Psst… try this one.',
      'I’ve highlighted my pick.',
    ], 'high'],
    win: ['excited', [
      'You did it! 🎉',
      'Victory! Maybe try a harder level next?',
      'GG! That was great to watch.',
      'Winner winner! 🏆',
    ], 'high'],
    loss: ['sad', [
      'Good fight! Tap 📋 Review and I’ll show you the turning point.',
      'Every loss is a free lesson. Check the review!',
      'Close one. Run it back?',
    ], 'high'],
    draw: ['happy', [
      'A draw! Nobody blinked.',
      'Evenly matched. Rematch?',
    ], 'high'],
    newBest: ['excited', [
      'New personal best! 🏆',
      'That’s your best ever!',
    ], 'high'],
    thinking: ['thinking', [
      'Hmm, the bot’s thinking…',
      'Let’s see what it does…',
    ], 'low'],
  };

  // Tap Pip for a tip about the current game.
  const TIPS = {
    chess: [
      'Control the centre early: e4, d4, Nf3, Nc3.',
      'Before every move, check: is anything of mine hanging?',
      'Castle early to keep your king safe.',
      'Knights on the rim are dim: keep them central.',
      'When ahead in material, trade pieces, not pawns.',
    ],
    checkers: [
      'Keep your back row filled as long as you can: it stops kings.',
      'Captures are forced, and you can use that to set traps!',
      'Pieces in the middle are stronger than ones on the edge.',
      'Get a king early: kings move both ways.',
    ],
    reversi: [
      'Corners can never be flipped, so grab them!',
      'Avoid the squares right next to an empty corner.',
      'Fewer discs early on is often better: it limits their moves.',
      'Try to leave your opponent with as few moves as possible.',
    ],
    connect4: [
      'The middle column is part of the most lines. Start there!',
      'Look for moves that make two threats at once.',
      'Always check: can they win next move?',
      'Don’t play under a square they need. You’ll hand it to them.',
    ],
    tictactoe: [
      'Corners are strong openings.',
      'A fork (two threats at once) can’t be blocked!',
      'Against the hard bot, a draw is a win. 😄',
    ],
    2048: [
      'Pick a corner for your biggest tile and keep it there.',
      'Try to use only three directions. Avoid the fourth.',
      'Keep your top row full so it can’t shift.',
      'Build a snake: big to small along the edges.',
    ],
    minesweeper: [
      'A 1 touching exactly one hidden square? That square is a mine.',
      'If a number already has all its mines flagged, the rest are safe.',
      'Corners and edges have fewer neighbours, so they’re easier to reason about.',
      'Long-press to flag, then tap a number to clear around it.',
    ],
    snake: [
      'Golden apples ⭐ are worth 5, but they vanish fast!',
      'Eat quickly in a row for a combo multiplier.',
      'Ghost 👻 lets you pass through yourself and walls. Use it wisely.',
      'Hug the edges early and leave yourself room.',
    ],
    default: [
      'Tap 💡 when you’re stuck, and 📋 Review after a game.',
      'Every daily you finish keeps your 🔥 streak alive.',
    ],
  };

  function greeting() {
    const h = new Date().getHours();
    const hello = h < 5 ? 'Up late? 🌙' : h < 12 ? 'Morning! ☀️' : h < 18 ? 'Hey there! 👋' : 'Evening! 🌆';
    const day = BB.dailyEntry(BB.today());
    const left = BB.dailies.filter((d) => !day[d.kind]?.done);
    const streak = BB.streak();
    if (!left.length) return [`${hello} All three dailies done. You’re a legend.`, 'excited'];
    if (streak >= 2) return [`${hello} ${streak}-day streak 🔥 Don’t break it now!`, 'excited'];
    if (left.length === BB.dailies.length) return [`${hello} Today’s ${left[0].name.toLowerCase()} is waiting for you.`, 'happy'];
    return [`${hello} ${left.length} daily ${left.length === 1 ? 'challenge' : 'challenges'} to go.`, 'happy'];
  }

  function create({ game = 'default' } = {}) {
    const face = el('button', { class: 'pip happy', type: 'button', 'aria-label': 'Pip the coach: tap for a tip' },
      el('span', { class: 'pip-eyes' }, el('i'), el('i')),
      el('span', { class: 'pip-mouth' }));
    const text = el('span', { class: 'pip-text' });
    const bubble = el('div', { class: 'pip-bubble', role: 'status', 'aria-live': 'polite' }, text);
    const root = el('div', { class: 'pip-wrap quiet' }, face, bubble);

    let lastSpoke = 0;
    let typing = null;
    let hideTimer = null;
    let tipIndex = Math.floor(Math.random() * 10);

    function mood(m) {
      face.className = `pip ${m}`;
    }

    function say(line, m = 'happy', { hold = 5500 } = {}) {
      if (!BB.settings.get('coach')) return;
      clearInterval(typing);
      clearTimeout(hideTimer);
      mood(m);
      root.classList.remove('quiet');
      lastSpoke = Date.now();
      // Type the line out quickly (or all at once with animations off).
      if (!BB.animMs(1)) text.textContent = line;
      else {
        let i = 0;
        text.textContent = '';
        typing = setInterval(() => {
          i += 2;
          text.textContent = line.slice(0, i);
          if (i >= line.length) clearInterval(typing);
        }, 22);
      }
      hideTimer = setTimeout(() => {
        root.classList.add('quiet');
        mood('happy');
      }, hold + line.length * 20);
    }

    /** React to a game event; `line` overrides the stock text. */
    function react(event, line) {
      const def = EVENTS[event];
      if (!def) return;
      const [m, lines, priority] = def;
      if (event === 'start' && lastSpoke) return; // don't talk over something already said
      if (priority === 'low' && (Date.now() - lastSpoke < 9000 || Math.random() > 0.4)) return;
      say(line || pick(lines), m);
    }

    function tip() {
      const list = TIPS[game] || TIPS.default;
      say(list[tipIndex++ % list.length], 'thinking');
    }

    face.addEventListener('click', tip);
    bubble.addEventListener('click', () => root.classList.add('quiet'));

    return {
      el: root,
      say,
      react,
      tip,
      destroy() {
        clearInterval(typing);
        clearTimeout(hideTimer);
      },
    };
  }

  return { create, greeting };
})();
