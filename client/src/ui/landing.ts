/**
 * Landing screen (P0-C-0 / OOM-16): one button to join the fight.
 * Kept to a single call-to-action so time-to-arena stays minimal.
 */
export function renderLanding(root: HTMLElement, onJoin: () => void): void {
  root.replaceChildren();

  const screen = document.createElement('section');
  screen.className = 'screen screen--landing';

  const title = document.createElement('h1');
  title.className = 'landing__title';
  title.textContent = 'Overworld One';

  const tagline = document.createElement('p');
  tagline.className = 'landing__tagline';
  tagline.textContent = 'One world. One boss. Everyone swings.';

  const join = document.createElement('button');
  join.className = 'btn btn--join';
  join.type = 'button';
  join.textContent = 'Join the fight';
  join.setAttribute('data-testid', 'join');
  join.addEventListener('click', onJoin, { once: true });

  screen.append(title, tagline, join);
  root.append(screen);

  // Focus the CTA so keyboard users can start with one keystroke.
  join.focus();
}
