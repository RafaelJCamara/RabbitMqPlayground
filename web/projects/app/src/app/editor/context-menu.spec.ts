import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ContextTarget } from '../canvas/model/intents';
import { ContextMenu, type MenuAction } from './context-menu';

/** The CDK reads `keyCode`, which a browser sets for Escape and user-event leaves at 0, so the key is sent as a browser sends it. */
const pressEscape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', keyCode: 27 });

/** The CDK reads `keyCode` here too, so the arrow key is sent as a browser sends it. */
const pressArrowDown = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown', keyCode: 40 });

async function renderMenu() {
  const chosen: MenuAction[] = [];
  const dismissed: number[] = [];
  const view = await render(ContextMenu, {
    on: { act: (action: MenuAction) => chosen.push(action), dismissed: () => dismissed.push(1) },
  });
  const open = async (target: ContextTarget, title: string) => {
    view.fixture.componentInstance.open(target, { x: 40, y: 60 }, title);
    view.fixture.detectChanges();
    return screen.findByRole('menu', { name: title });
  };
  return { ...view, chosen, dismissed, open, user: userEvent.setup() };
}

describe('ContextMenu', () => {
  it('is not there until it is opened', async () => {
    await renderMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('offers rename and delete for a node, and says what it is for', async () => {
    const { open } = await renderMenu();

    const menu = await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');

    expect(menu).toHaveAccessibleName('Actions for queue billing');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual(['Rename', 'Delete']);
    expect(items.map((item) => item.querySelector('kbd')?.textContent)).toEqual(['F2', 'Delete']);
  });

  it('is in a landmark of its own, because the CDK draws it outside every other one', async () => {
    const { open } = await renderMenu();

    const menu = await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');

    expect(screen.getByRole('region', { name: 'Context menu' })).toContainElement(menu);
  });

  it('has the focus on its first item when it opens, so that the arrow keys work at once', async () => {
    const { open } = await renderMenu();

    await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');

    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());
  });

  it('goes to the second item with the first arrow key, because the first is the active one and not only the one with the focus', async () => {
    const { open } = await renderMenu();
    await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());

    pressArrowDown();

    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
  });

  it('offers only delete for an edge', async () => {
    const { open } = await renderMenu();

    await open({ kind: 'edge', key: 'E1>Q1' }, 'Actions for this edge');

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual(['Delete']);
  });

  it('says what was chosen, and for what, and closes', async () => {
    const { open, chosen, dismissed, user } = await renderMenu();
    await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');

    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));

    expect(chosen).toEqual([{ action: 'rename', target: { kind: 'node', id: 'Q1' } }]);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(dismissed).toEqual([]);
  });

  it('says what was chosen from the keyboard as well, with Enter on an item', async () => {
    const { open, chosen, user } = await renderMenu();
    await open({ kind: 'edge', key: 'E1>Q1' }, 'Actions for this edge');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(chosen).toEqual([{ action: 'delete', target: { kind: 'edge', key: 'E1>Q1' } }]);
  });

  it('says that it was closed without a choice when Escape closes it, so that the focus can go back', async () => {
    const { open, chosen, dismissed } = await renderMenu();
    await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');

    pressEscape();

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(dismissed).toEqual([1]);
    expect(chosen).toEqual([]);
  });

  it('can be opened again for another target, with the items and the name of that one', async () => {
    const { open } = await renderMenu();
    await open({ kind: 'node', id: 'Q1' }, 'Actions for queue billing');
    pressEscape();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await open({ kind: 'edge', key: 'E1>Q1' }, 'Actions for this edge');

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });
});

/**
 * macOS and Linux open the menu when the right button goes down, so the release of the button arrives after the menu is open, outside
 * it. The events here are the ones that come after the menu is open, in the order that those systems send them.
 */
describe('ContextMenu, when the click that opened it comes to its end', () => {
  const menuName = 'Actions for queue billing';
  const queue: ContextTarget = { kind: 'node', id: 'Q1' };
  const gone = () => waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  const releaseRightButton = () =>
    fireEvent(document.body, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }));

  it('stays open when the right button comes up, and closes with the next click outside', async () => {
    const { open, dismissed } = await renderMenu();
    await open(queue, menuName);

    releaseRightButton();

    expect(screen.getByRole('menu', { name: menuName })).toBeInTheDocument();
    fireEvent.click(document.body);
    await gone();
    expect(dismissed).toEqual([1]);
  });

  it('stays open when a Control click of a Mac comes up, which ends in a click', async () => {
    const { open } = await renderMenu();
    await open(queue, menuName);

    fireEvent.click(document.body, { ctrlKey: true });

    expect(screen.getByRole('menu', { name: menuName })).toBeInTheDocument();
  });

  it('closes with a click outside that follows a press, which is a click meant to close it', async () => {
    const { open } = await renderMenu();
    await open(queue, menuName);

    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    await gone();
  });

  it('closes with a click outside that follows a key, which is something other than the end of the click', async () => {
    const { open } = await renderMenu();
    await open(queue, menuName);

    fireEvent.keyDown(document.body, { key: 'Shift', keyCode: 16 });
    fireEvent.click(document.body);

    await gone();
  });

  it('closes with a right click outside as well, once the first has come up', async () => {
    const { open } = await renderMenu();
    await open(queue, menuName);
    releaseRightButton();

    fireEvent.pointerDown(document.body, { button: 2 });
    releaseRightButton();

    await gone();
  });

  it('lets a click in the menu through, because that is a choice and not the end of the click that opened it', async () => {
    const { open, chosen } = await renderMenu();
    await open(queue, menuName);

    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));

    expect(chosen).toEqual([{ action: 'rename', target: queue }]);
  });

  it('holds the end of the click that opens it again, when it is opened again where it is', async () => {
    const { open, fixture } = await renderMenu();
    await open(queue, menuName);
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await gone();

    fixture.componentInstance.open(queue, { x: 80, y: 90 }, menuName);
    fixture.detectChanges();
    await screen.findByRole('menu', { name: menuName });
    releaseRightButton();

    expect(screen.getByRole('menu', { name: menuName })).toBeInTheDocument();
  });

  it('stops holding it when the menu is taken away, so that the page hears its clicks', async () => {
    const { open, fixture } = await renderMenu();
    await open(queue, menuName);
    fixture.destroy();
    const heard: Event[] = [];
    document.addEventListener('click', (event) => heard.push(event), { once: true });

    fireEvent.click(document.body);

    expect(heard).toHaveLength(1);
  });
});
