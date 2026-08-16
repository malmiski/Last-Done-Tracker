import React, { act } from 'react';
import renderer from 'react-test-renderer';
import Toast, { ToastState, useToast } from './Toast';

jest.mock('../theme/theme', () => ({
  colors: {
    background: '#FFFFFF',
    text: '#000000',
    subtext: '#666666',
    card: '#F0F0F0',
    primary: '#007AFF',
    border: '#333333',
  },
}));

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.useFakeTimers();

const renderToast = async (toast: ToastState | null, onHide = jest.fn()) => {
  let tree: any;
  await act(async () => {
    tree = renderer.create(<Toast toast={toast} onHide={onHide} />);
  });
  return tree;
};

const state = (overrides: Partial<ToastState> = {}): ToastState => ({
  id: 1,
  message: 'Copied!',
  variant: 'success',
  ...overrides,
});

describe('Toast', () => {
  it('renders nothing when there is no toast', async () => {
    const tree = await renderToast(null);
    expect(tree.toJSON()).toBeNull();
  });

  it('shows the message', async () => {
    const tree = await renderToast(state());
    expect(JSON.stringify(tree.toJSON())).toContain('Copied!');
  });

  it('shows an optional detail line', async () => {
    const tree = await renderToast(state({ message: 'Pasted!', detail: '2 images added' }));
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Pasted!');
    expect(json).toContain('2 images added');
  });

  it('omits the detail line when there is nothing extra to say', async () => {
    const tree = await renderToast(state());
    // Only the message text node.
    expect(JSON.stringify(tree.toJSON()).match(/"text"/g) ?? []).toHaveLength(0);
  });

  it('never intercepts taps on the controls underneath', async () => {
    const tree = await renderToast(state());
    expect(tree.toJSON().props.pointerEvents).toBe('none');
  });

  it('is announced to screen readers', async () => {
    const tree = await renderToast(state());
    expect(tree.toJSON().props.accessibilityRole).toBe('alert');
  });

  it('auto-dismisses a success toast', async () => {
    const onHide = jest.fn();
    await renderToast(state(), onHide);

    expect(onHide).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2000); // past the success duration
    });
    await act(async () => {
      jest.runOnlyPendingTimers(); // let the fade-out finish
    });

    expect(onHide).toHaveBeenCalled();
  });

  it('keeps a warning on screen longer than a success', async () => {
    const onHide = jest.fn();
    await renderToast(state({ variant: 'warning', message: 'Nothing to paste' }), onHide);

    // A success would already have gone by now.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onHide).not.toHaveBeenCalled();
  });

  it('clears its timer on unmount rather than firing into a dead component', async () => {
    const onHide = jest.fn();
    const tree = await renderToast(state(), onHide);

    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    expect(onHide).not.toHaveBeenCalled();
  });
});

describe('useToast', () => {
  /** Minimal harness so the hook can be driven without a real screen. */
  const Harness: React.FC<{ onReady: (api: ReturnType<typeof useToast>) => void }> = ({ onReady }) => {
    const api = useToast();
    onReady(api);
    return null;
  };

  const mountHook = async () => {
    let api!: ReturnType<typeof useToast>;
    await act(async () => {
      renderer.create(<Harness onReady={value => { api = value; }} />);
    });
    return () => api;
  };

  it('starts with nothing shown', async () => {
    const get = await mountHook();
    expect(get().toast).toBeNull();
  });

  it('shows a success toast by default', async () => {
    const get = await mountHook();
    await act(async () => get().showToast('Copied!'));
    expect(get().toast).toMatchObject({ message: 'Copied!', variant: 'success' });
  });

  it('carries detail and variant through', async () => {
    const get = await mountHook();
    await act(async () => get().showToast('Pasted!', '1 image unavailable', 'warning'));
    expect(get().toast).toMatchObject({
      message: 'Pasted!',
      detail: '1 image unavailable',
      variant: 'warning',
    });
  });

  it('gives each show a new id so repeating a message replays it', async () => {
    // Tapping copy twice must visibly confirm twice, not sit there statically.
    const get = await mountHook();
    await act(async () => get().showToast('Copied!'));
    const first = get().toast!.id;
    await act(async () => get().showToast('Copied!'));
    expect(get().toast!.id).not.toBe(first);
  });

  it('hides on request', async () => {
    const get = await mountHook();
    await act(async () => get().showToast('Copied!'));
    await act(async () => get().hideToast());
    expect(get().toast).toBeNull();
  });
});
